
/* ---------------- Helpers ---------------- */

const T = (el) => (el ? el.textContent.trim() : "");

function getResultNodes() {
  // Include classic search tiles and "rich" grid tiles, but only those with a video title link.
  const a = Array.from(document.querySelectorAll("ytd-video-renderer"));
  const b = Array.from(
    document.querySelectorAll("ytd-rich-item-renderer")
  ).filter((n) => n.querySelector("a#video-title"));
  // Exclude obvious ad containers if present
  const nodes = [...a, ...b].filter((n) => !n.closest("ytd-ad-slot-renderer"));
  return nodes;
}

function parseMeta(node) {
  const metaLine = node.querySelector("#metadata-line");
  const parts = metaLine
    ? Array.from(metaLine.children).map((el) => T(el))
    : [];
  let views = "",
    uploadDate = "";
  if (parts.length >= 2) {
    const vIdx = parts.findIndex((p) => /view/i.test(p));
    if (vIdx !== -1) {
      views = parts[vIdx];
      uploadDate =
        parts[vIdx === 0 ? 1 : 0] || parts.find((p, i) => i !== vIdx) || "";
    } else {
      [views, uploadDate] = parts;
    }
  } else if (parts.length === 1) {
    if (/view/i.test(parts[0])) views = parts[0];
    else uploadDate = parts[0];
  }
  return { views, uploadDate };
}

function getVideoId(url) {
  if (!url) return "";
  try {
    const u = new URL(url);
    if (u.pathname.startsWith("/watch")) return u.searchParams.get("v") || "";
    if (u.pathname.startsWith("/shorts/"))
      return u.pathname.split("/shorts/")[1]?.split("/")[0] || "";
  } catch {}
  return "";
}

function extractChannelHandle(channelUrl) {
  if (!channelUrl) return "";
  
  try {
    const u = new URL(channelUrl);
    const path = u.pathname;
    
    // Handle URLs like: /c/username, /@username, /user/username, /channel/username
    if (path.startsWith("/@")) {
      // Direct handle: /@username
      return path.split("/")[1] || "";
    } else if (path.startsWith("/c/")) {
      // Custom URL: /c/username -> @username  
      const handle = path.split("/c/")[1]?.split("/")[0];
      return handle ? "@" + handle : "";
    } else if (path.startsWith("/user/")) {
      // Legacy user URL: /user/username -> @username
      const handle = path.split("/user/")[1]?.split("/")[0];
      return handle ? "@" + handle : "";
    } else if (path.startsWith("/channel/")) {
      // Channel ID URL - can't extract handle from this
      return "";
    }
    
    return "";
  } catch (error) {
    return "";
  }
}

function scrapeSearchOnce() {
  const items = [];
  for (const node of getResultNodes()) {
    const titleEl = node.querySelector("a#video-title");
    const channelEl = node.querySelector("ytd-channel-name a");
    const { views, uploadDate } = parseMeta(node);
    const durationEl =
      node.querySelector("ytd-thumbnail-overlay-time-status-renderer span") ||
      node.querySelector("span.ytd-thumbnail-overlay-time-status-renderer");

    const url = titleEl?.href || "";
    const videoId = getVideoId(url);

    const channelUrl = channelEl?.href || "";
    const channelHandle = extractChannelHandle(channelUrl);

    items.push({
      title: T(titleEl),
      channel: T(channelEl),
      channelUrl,
      channelHandle,
      views,
      length: T(durationEl),
      uploadDate,
      videoId,
    });
  }

  // Dedup by videoId or url
  const seen = new Set();
  const deduped = [];
  for (const r of items) {
    const key = r.videoId || r.url;
    if (key && seen.has(key)) continue;
    seen.add(key);
    deduped.push(r);
  }
  return deduped;
}

/* ---------------- Subscriber fetching ---------------- */

const channelCache = new Map();

async function fetchChannelData(channelUrl) {
  if (!channelUrl) return { subscribers: "", handle: "" };
  const rootUrl = channelUrl.replace(
    /\/(videos|about|streams|playlists|featured)(\/)?$/i,
    ""
  );
  if (channelCache.has(rootUrl)) return channelCache.get(rootUrl);

  const extractFromHtml = (html) => {
    // Look for subscriber count with better patterns
    let subscribers = "";
    const subPatterns = [
      /([\d,.]+ ?[KMB]?) subscribers?/i,     // "1.2M subscribers" or "1.2M subscriber"
      /([\d,.]+ ?[KMB]?) subscriber/i,      // "1.2M subscriber" 
      /"subscriberCountText".*?"([\d,.]+ ?[KMB]?) subscribers?"/i,  // JSON subscriberCountText
      /"subscriberCount".*?"([\d,.]+ ?[KMB]?)"/i,                   // JSON subscriberCount
      /(\d+\.?\d* ?[KMB]?) subscribers?/i                           // More flexible number matching
    ];
    
    for (const pattern of subPatterns) {
      const match = html.match(pattern);
      if (match && match[1] && match[1].trim()) {
        subscribers = match[1].trim();
        if (!subscribers.toLowerCase().includes('subscriber')) {
          subscribers += ' subscribers';
        }
        // Validate it looks like a real subscriber count
        if (/^[\d,.]+ ?[KMB]? subscribers?$/i.test(subscribers)) {
          break;
        } else {
          subscribers = ""; // Reset if invalid
        }
      }
    }
    
    // Extract channel handle with better patterns
    let handle = "";
    const handlePatterns = [
      /canonicalChannelUrl.*?\/(@[a-zA-Z0-9._-]+)/i,  // canonicalChannelUrl with @handle
      /vanityChannelUrl.*?\/(@[a-zA-Z0-9._-]+)/i,     // vanityChannelUrl with @handle  
      /"@([a-zA-Z0-9._-]+)"/,                          // "@handle" in quotes
      /handle["':\s]*"?@?([a-zA-Z0-9._-]+)"?/i,       // handle field
      /@([a-zA-Z0-9._-]+)(?=\s|$|"|,|<|>)/           // standalone @handle
    ];
    
    for (const pattern of handlePatterns) {
      const match = html.match(pattern);
      if (match && match[1] && match[1] !== 'null' && match[1].length > 0) {
        handle = match[1].startsWith('@') ? match[1] : '@' + match[1];
        // Exclude obvious false positives
        if (!handle.includes('.') || handle.includes('_')) {
          break;
        }
      }
    }
    
    return { subscribers, handle };
  };

  let channelData = { subscribers: "", handle: "" };
  try {
    const res = await fetch(rootUrl, { credentials: "include" });
    const html = await res.text();
    channelData = extractFromHtml(html);
    if (!channelData.subscribers || !channelData.handle) {
      const res2 = await fetch(rootUrl.replace(/\/$/, "") + "/about", {
        credentials: "include",
      });
      const html2 = await res2.text();
      const aboutData = extractFromHtml(html2);
      channelData.subscribers = channelData.subscribers || aboutData.subscribers;
      channelData.handle = channelData.handle || aboutData.handle;
    }
  } catch {
    // ignore errors; leave blank
  }
  channelCache.set(rootUrl, channelData);
  return channelData;
}

async function enrichWithChannelData(rows) {
  // Warm the cache with limited concurrency
  const uniqueUrls = Array.from(
    new Set(rows.map((r) => r.channelUrl).filter(Boolean))
  );
  const BATCH = 5;
  for (let i = 0; i < uniqueUrls.length; i += BATCH) {
    const slice = uniqueUrls.slice(i, i + BATCH);
    await Promise.all(slice.map((u) => fetchChannelData(u)));
  }
  for (const r of rows) {
    if (r.channelUrl) {
      const channelData = await fetchChannelData(r.channelUrl);
      r.subscribers = channelData.subscribers;
      // Keep existing channelHandle from URL extraction, fallback to HTML extraction
      if (!r.channelHandle && channelData.handle) {
        r.channelHandle = channelData.handle;
      }
    } else {
      r.subscribers = "";
      // Keep existing channelHandle if no URL
    }
  }
  return rows;
}

/* ---------------- Auto-scroll logic ---------------- */

/**
 * Scrolls down repeatedly until:
 *  - no new results are detected for `stallRounds` consecutive cycles, or
 *  - `maxItems` (if > 0) is reached.
 * Then scrolls back to top.
 */
async function autoScrollUntilDone({
  stallRounds = 3,
  delayMs = 1200,
  maxItems = 0,
} = {}) {
  let prevCount = 0;
  let stalls = 0;

  while (true) {
    window.scrollTo(0, document.documentElement.scrollHeight);
    await new Promise((r) => setTimeout(r, delayMs));

    const count = getResultNodes().length;
    const hitMax = maxItems > 0 && count >= maxItems;

    if (count <= prevCount) stalls++;
    else stalls = 0;
    prevCount = count;

    if (stalls >= stallRounds || hitMax) break;
  }
  window.scrollTo(0, 0);
  await new Promise((r) => setTimeout(r, 400));
}

async function runScrape({
  auto = false,
  stallRounds = 3,
  delayMs = 1200,
  maxItems = 0,
} = {}) {
  if (auto) {
    await autoScrollUntilDone({ stallRounds, delayMs, maxItems });
  }

  const base = scrapeSearchOnce();
  const full = await enrichWithChannelData(base);

  // Final shape/order (exactly the fields you asked for)
  return full.map((r) => ({
    title: r.title,
    channel: r.channel,
    channelHandle: r.channelHandle, // ex: "@username"
    subscribers: r.subscribers, // ex: "1.23M subscribers"
    views: r.views,
    length: r.length,
    uploadDate: r.uploadDate,
    videoId: r.videoId,
  }));
}

/* ---------------- Auto-scraping on page load ---------------- */

let autoScrapeData = null;
let lastUrl = window.location.href;
let continuousScrolling = false;

// Function to auto-scrape current page
async function performAutoScrape() {
  try {
    // Only auto-scrape on YouTube search results pages
    if (!window.location.href.includes('youtube.com/results')) {
      autoScrapeData = null;
      return;
    }
    
    // Wait a bit for the page to fully load
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    autoScrapeData = await runScrape({ auto: false });
    console.log(`Auto-scraped ${autoScrapeData.length} items`);
  } catch (error) {
    console.error('Auto-scrape failed:', error);
    autoScrapeData = null;
  }
}

// Watch for URL changes (YouTube is a SPA)
function watchForUrlChanges() {
  const observer = new MutationObserver(() => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      // Delay to let the page load
      setTimeout(performAutoScrape, 1500);
    }
  });
  
  observer.observe(document, { subtree: true, childList: true });
}

// Initialize auto-scraping
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(performAutoScrape, 1000);
    watchForUrlChanges();
  });
} else {
  setTimeout(performAutoScrape, 1000);
  watchForUrlChanges();
}

/* ---------------- Continuous scrolling functions ---------------- */

function startContinuousScrolling() {
  if (continuousScrolling || !window.location.href.includes('youtube.com/results')) {
    console.log('Cannot start scrolling - already running or not on YouTube results page');
    return;
  }
  
  continuousScrolling = true;
  console.log('Starting continuous auto-scroll');
  
  const performScroll = async () => {
    if (!continuousScrolling) return;
    
    const beforeHeight = document.documentElement.scrollHeight;
    const currentScrollTop = window.pageYOffset || document.documentElement.scrollTop;
    
    console.log(`Scrolling - Current height: ${beforeHeight}, Current scroll: ${currentScrollTop}`);
    
    // Scroll to bottom
    window.scrollTo({
      top: beforeHeight,
      behavior: 'smooth'
    });
    
    // Wait for scroll and new content to load
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const afterHeight = document.documentElement.scrollHeight;
    console.log(`After scroll - New height: ${afterHeight}`);
    
    // Update scraped data
    try {
      const newData = await runScrape({ auto: false });
      autoScrapeData = newData;
      console.log(`Scraped ${newData.length} items`);
    } catch (error) {
      console.error('Continuous scroll scrape failed:', error);
    }
    
    // Continue scrolling if we're still active and got new content
    if (continuousScrolling) {
      setTimeout(performScroll, 1000);
    }
  };
  
  // Start the first scroll
  setTimeout(performScroll, 500);
}

function stopContinuousScrolling() {
  continuousScrolling = false;
  console.log('Stopped continuous auto-scroll');
}

/* ---------------- MV3 message bridge ---------------- */

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      if (msg?.cmd === "SCRAPE_VISIBLE") {
        // Use auto-scraped data if available and recent, otherwise scrape fresh
        let data;
        if (autoScrapeData && window.location.href.includes('youtube.com/results')) {
          data = autoScrapeData;
        } else {
          data = await runScrape({ auto: false });
        }
        sendResponse({ ok: true, data });
      } else if (msg?.cmd === "SCRAPE_FRESH") {
        // Always scrape fresh data, don't use cache
        console.log("SCRAPE_FRESH command received");
        const data = await runScrape({ auto: false });
        autoScrapeData = data; // Update cache with fresh data
        console.log(`SCRAPE_FRESH completed: ${data.length} items`);
        sendResponse({ ok: true, data });
      } else if (msg?.cmd === "SCROLL_AND_SCRAPE") {
        const data = await runScrape({
          auto: true,
          stallRounds: msg.stallRounds ?? 3,
          delayMs: msg.delayMs ?? 1200,
          maxItems: msg.maxItems ?? 0,
        });
        // Update the auto-scraped data cache
        autoScrapeData = data;
        sendResponse({ ok: true, data });
      } else if (msg?.cmd === "GET_AUTO_DATA") {
        // Command to get pre-scraped data without triggering new scrape
        sendResponse({ ok: true, data: autoScrapeData || [] });
      } else if (msg?.cmd === "START_AUTO_SCROLL") {
        startContinuousScrolling();
        sendResponse({ ok: true, data: autoScrapeData || [] });
      } else if (msg?.cmd === "STOP_AUTO_SCROLL") {
        stopContinuousScrolling();
        sendResponse({ ok: true });
      } else if (msg?.cmd === "GET_CURRENT_DATA") {
        // Get current data during auto-scroll mode
        sendResponse({ ok: true, data: autoScrapeData || [] });
      } else {
        sendResponse({ ok: false, error: "Unknown command" });
      }
    } catch (e) {
      sendResponse({ ok: false, error: String(e) });
    }
  })();
  return true; // keep channel open for async
});
