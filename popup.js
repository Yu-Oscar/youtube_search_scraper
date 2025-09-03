let currentData = [];
let exportList = [];
let isAutoScrolling = false;
let autoScrollInterval = null;

// Storage keys
const EXPORT_LIST_KEY = 'youtube_scraper_export_list';


async function sendToActiveTab(message) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active tab.");
  
  // Check if we're on a YouTube search page
  if (!tab.url || !tab.url.includes('youtube.com/results')) {
    return { ok: false, error: "Not on YouTube search page", showInList: true };
  }
  
  // Ensure content script is present on the page
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["content.js"],
  });
  return chrome.tabs.sendMessage(tab.id, message);
}

function download(filename, mime, text) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function displayResults(data) {
  const resultsDiv = document.getElementById("results");
  const resultsLoadingDiv = document.getElementById("results-loading");
  const foundSectionDiv = document.getElementById("found-section");
  const actionsDiv = document.getElementById("actions");
  const exportSectionDiv = document.getElementById("export-section");
  const bottomActionsDiv = document.getElementById("bottom-actions");
  const errorDiv = document.getElementById("error");
  
  resultsLoadingDiv.style.display = "none";
  errorDiv.style.display = "none";
  
  if (!data || data.length === 0) {
    resultsDiv.innerHTML = '<div class="error">No results found on this page.</div>';
    return;
  }
  
  currentData = data;
  
  // Filter to show only new items (not already in export list)
  const exportCount = exportList.length;
  const existingVideoIds = new Set(exportList.map(item => item.videoId));
  const newItems = data.filter(item => item.videoId && !existingVideoIds.has(item.videoId));
  const newItemsCount = newItems.length;
  
  // Update individual count displays
  document.getElementById("new-items-count").textContent = `New Items: ${newItemsCount}`;
  document.getElementById("export-items-count").textContent = `Export List: ${exportCount}`;
  
  foundSectionDiv.style.display = "flex";
  actionsDiv.style.display = "block";
  exportSectionDiv.style.display = "block";
  bottomActionsDiv.style.display = "flex";
  document.getElementById("batch-section").style.display = "block";
  
  if (newItems.length === 0) {
    resultsDiv.innerHTML = '<div class="error">No new items found. All videos are already in your export list.</div>';
    return;
  }
  
  resultsDiv.innerHTML = newItems.map(item => `
    <div class="item">
      <a href="https://youtube.com/watch?v=${item.videoId}" class="title" target="_blank">
        ${escapeHtml(truncateTitle(item.title || 'Untitled', 45))}
      </a>
      <div class="channel">${escapeHtml(truncateText(item.channel || 'Unknown Channel', 30))} ${item.channelHandle ? '<span style="color: #888;">' + escapeHtml(item.channelHandle) + '</span>' : ''}</div>
      <div class="meta">
        ${formatMetaData([
          item.subscribers,
          item.views, 
          item.length,
          item.uploadDate
        ].filter(Boolean))}
      </div>
    </div>
  `).join('');
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function truncateText(text, maxLength) {
  if (!text || text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
}

function truncateTitle(title, maxLength) {
  if (!title || title.length <= maxLength) return title;
  return title.substring(0, maxLength - 3) + '...';
}

function formatMetaData(items) {
  return items.map(item => `<span>${escapeHtml(item)}</span>`).join('');
}

// Export list management functions
async function loadExportList() {
  try {
    const result = await chrome.storage.local.get(EXPORT_LIST_KEY);
    exportList = result[EXPORT_LIST_KEY] || [];
    updateExportListDisplay();
  } catch (error) {
    console.error('Failed to load export list:', error);
    exportList = [];
  }
}

async function saveExportList() {
  try {
    await chrome.storage.local.set({ [EXPORT_LIST_KEY]: exportList });
    updateExportListDisplay();
  } catch (error) {
    console.error('Failed to save export list:', error);
  }
}

function appendToExportList() {
  if (!currentData || currentData.length === 0) {
    return;
  }
  
  const existingVideoIds = new Set(exportList.map(item => item.videoId));
  const newItems = currentData.filter(item => item.videoId && !existingVideoIds.has(item.videoId));
  
  if (newItems.length === 0) {
    return;
  }
  
  // Add timestamp to each item
  const timestamp = new Date().toISOString();
  const itemsWithTimestamp = newItems.map(item => ({
    ...item,
    addedAt: timestamp
  }));
  
  exportList.push(...itemsWithTimestamp);
  saveExportList();
  
  // Refresh the count display with updated numbers
  const exportCount = exportList.length;
  const updatedExistingVideoIds = new Set(exportList.map(item => item.videoId));
  const newItemsCount = currentData.filter(item => item.videoId && !updatedExistingVideoIds.has(item.videoId)).length;
  
  document.getElementById("new-items-count").textContent = `New Items: ${newItemsCount}`;
  document.getElementById("export-items-count").textContent = `Export List: ${exportCount}`;
  
  // Refresh the display to show only remaining new items
  displayResults(currentData);
}

function clearFoundList() {
  if (!currentData || currentData.length === 0) return;
  
  currentData = [];
  const resultsDiv = document.getElementById("results");
  
  resultsDiv.innerHTML = '<div class="error">No current results. Use refresh to reload data.</div>';
  document.getElementById("new-items-count").textContent = "New Items: 0";
}

function clearExportList() {
  if (exportList.length === 0) return;
  
  exportList = [];
  saveExportList();
  
  // Refresh the count display
  if (currentData.length > 0) {
    const exportCount = exportList.length;
    const clearedExistingVideoIds = new Set(exportList.map(item => item.videoId));
    const newItemsCount = currentData.filter(item => item.videoId && !clearedExistingVideoIds.has(item.videoId)).length;
    
    document.getElementById("new-items-count").textContent = `New Items: ${newItemsCount}`;
    document.getElementById("export-items-count").textContent = `Export List: ${exportCount}`;
  }
}

function updateExportListDisplay() {
  document.getElementById("export-items-count").textContent = `Export List: ${exportList.length}`;
}

function showError(message) {
  const errorDiv = document.getElementById("error");
  
  errorDiv.textContent = message;
  errorDiv.style.display = "block";
}

async function loadData() {
  try {
    console.log("loadData() called");
    // Show loading state in list area only, keep UI elements visible
    const resultsLoadingDiv = document.getElementById("results-loading");
    const resultsDiv = document.getElementById("results");
    const errorDiv = document.getElementById("error");
    const foundSectionDiv = document.getElementById("found-section");
    const actionsDiv = document.getElementById("actions");
    const exportSectionDiv = document.getElementById("export-section");
    const bottomActionsDiv = document.getElementById("bottom-actions");
    
    // Show all UI elements immediately
    foundSectionDiv.style.display = "flex";
    actionsDiv.style.display = "block";
    exportSectionDiv.style.display = "block";
    bottomActionsDiv.style.display = "flex";
    document.getElementById("batch-section").style.display = "block";
    
    // Show loading only in results area
    resultsLoadingDiv.style.display = "flex";
    resultsDiv.innerHTML = "";
    errorDiv.style.display = "none";
    
    // Update counts
    document.getElementById("new-items-count").textContent = "New Items: 0";
    document.getElementById("export-items-count").textContent = `Export List: ${exportList.length}`;
    
    console.log("Sending SCRAPE_FRESH command");
    const resp = await sendToActiveTab({
      cmd: "SCRAPE_FRESH"
    });
    
    console.log("Response received:", resp);
    if (!resp?.ok) {
      resultsLoadingDiv.style.display = "none";
      if (resp?.showInList) {
        // Show message in results area instead of error area (UI already visible)
        resultsDiv.innerHTML = '<div class="error">Please navigate to a YouTube search results page first.</div>';
        return;
      } else {
        throw new Error(resp?.error || "Failed to scrape data.");
      }
    }
    
    displayResults(resp.data);
  } catch (error) {
    console.error("loadData error:", error);
    // Hide loading and show error
    const resultsLoadingDiv = document.getElementById("results-loading");
    resultsLoadingDiv.style.display = "none";
    showError(error.message);
  }
}

async function startAutoScroll() {
  if (isAutoScrolling) return;
  
  isAutoScrolling = true;
  const autoBtn = document.getElementById("auto-scroll");
  autoBtn.textContent = "Stop";
  autoBtn.classList.add("active");
  
  try {
    console.log("Starting auto-scroll...");
    // Start continuous scrolling in content script
    const startResp = await sendToActiveTab({ cmd: "START_AUTO_SCROLL" });
    console.log("Auto-scroll start response:", startResp);
    
    // Update data every 3 seconds
    autoScrollInterval = setInterval(async () => {
      if (!isAutoScrolling) return;
      
      try {
        const resp = await sendToActiveTab({ cmd: "GET_CURRENT_DATA" });
        if (resp?.ok && resp.data) {
          console.log(`Auto-scroll update: ${resp.data.length} items`);
          displayResults(resp.data);
        }
      } catch (error) {
        console.error("Auto-scroll update failed:", error);
      }
    }, 3000);
    
  } catch (error) {
    console.error("Failed to start auto-scroll:", error);
    stopAutoScroll();
    showError("Failed to start auto-scroll: " + error.message);
  }
}

async function stopAutoScroll() {
  isAutoScrolling = false;
  
  if (autoScrollInterval) {
    clearInterval(autoScrollInterval);
    autoScrollInterval = null;
  }
  
  const autoBtn = document.getElementById("auto-scroll");
  autoBtn.textContent = "Auto";
  autoBtn.classList.remove("active");
  
  try {
    // Stop scrolling in content script
    await sendToActiveTab({ cmd: "STOP_AUTO_SCROLL" });
  } catch (error) {
    console.error("Failed to stop auto-scroll:", error);
  }
}

function toggleAutoScroll() {
  if (isAutoScrolling) {
    stopAutoScroll();
  } else {
    startAutoScroll();
  }
}

// Event listeners
document.getElementById("download-json").onclick = () => {
  if (currentData.length > 0) {
    download(
      "youtube_search.json",
      "application/json",
      JSON.stringify(currentData, null, 2)
    );
  }
};


document.getElementById("append-to-export").onclick = appendToExportList;

document.getElementById("clear-found").onclick = clearFoundList;

document.getElementById("clear-export").onclick = clearExportList;


document.getElementById("auto-scroll").onclick = toggleAutoScroll;

async function loadInitialData() {
  try {
    const resultsLoadingDiv = document.getElementById("results-loading");
    const resultsDiv = document.getElementById("results");
    const errorDiv = document.getElementById("error");
    const foundSectionDiv = document.getElementById("found-section");
    const actionsDiv = document.getElementById("actions");
    const exportSectionDiv = document.getElementById("export-section");
    const bottomActionsDiv = document.getElementById("bottom-actions");
    
    // Show all UI elements immediately
    foundSectionDiv.style.display = "flex";
    actionsDiv.style.display = "block";
    exportSectionDiv.style.display = "block";
    bottomActionsDiv.style.display = "flex";
    document.getElementById("batch-section").style.display = "block";
    
    // Show loading only in results area
    resultsLoadingDiv.style.display = "flex";
    resultsDiv.innerHTML = "";
    errorDiv.style.display = "none";
    
    // Update counts
    document.getElementById("new-items-count").textContent = "New Items: 0";
    document.getElementById("export-items-count").textContent = `Export List: ${exportList.length}`;
    
    const resp = await sendToActiveTab({
      cmd: "SCRAPE_VISIBLE"
    });
    
    if (!resp?.ok) {
      resultsLoadingDiv.style.display = "none";
      if (resp?.showInList) {
        // Show message in results area instead of error area (UI already visible)
        resultsDiv.innerHTML = '<div class="error">Please navigate to a YouTube search results page first.</div>';
        return;
      } else {
        throw new Error(resp?.error || "Failed to scrape data.");
      }
    }
    
    displayResults(resp.data);
  } catch (error) {
    const resultsLoadingDiv = document.getElementById("results-loading");
    resultsLoadingDiv.style.display = "none";
    showError(error.message);
  }
}

// Auto-load data when popup opens
document.addEventListener('DOMContentLoaded', () => {
  console.log("DOM loaded, setting up event listeners");
  loadInitialData();
  loadExportList();
  
  // Set up refresh button event listener
  const refreshBtn = document.getElementById("refresh");
  if (refreshBtn) {
    refreshBtn.onclick = () => {
      console.log("Refresh button clicked");
      loadData();
    };
    console.log("Refresh button event listener attached");
  } else {
    console.error("Refresh button not found!");
  }
  
  // Set up batch scrape toggle and functionality
  const toggleBatchBtn = document.getElementById("toggle-batch");
  const batchForm = document.getElementById("batch-form");
  
  toggleBatchBtn.onclick = () => {
    if (batchForm.style.display === "none") {
      batchForm.style.display = "block";
      toggleBatchBtn.textContent = "Hide";
    } else {
      batchForm.style.display = "none";
      toggleBatchBtn.textContent = "Show";
    }
  };
  
  // Batch scrape functionality
  document.getElementById("start-batch-scrape").onclick = startBatchScrape;
  document.getElementById("clear-batch-form").onclick = () => {
    document.getElementById("search-queries").value = "";
    document.getElementById("video-count").value = "20";
    hideBatchStatus();
  };
});

// Stop auto-scroll when popup is closed
window.addEventListener('beforeunload', () => {
  if (isAutoScrolling) {
    stopAutoScroll();
  }
});

// Batch scrape functionality
let isBatchRunning = false;

function showBatchStatus(message, type = 'info') {
  const statusDiv = document.getElementById("batch-status");
  statusDiv.className = type === 'error' ? 'error' : '';
  statusDiv.style.background = type === 'error' ? 'rgba(244, 67, 54, 0.1)' : 
                                type === 'success' ? 'rgba(76, 175, 80, 0.1)' : 'rgba(33, 150, 243, 0.1)';
  statusDiv.style.color = type === 'error' ? '#e57373' :
                          type === 'success' ? '#81c784' : '#64b5f6';
  statusDiv.textContent = message;
  statusDiv.style.display = 'block';
}

function hideBatchStatus() {
  document.getElementById("batch-status").style.display = 'none';
}

async function startBatchScrape() {
  if (isBatchRunning) return;
  
  const queriesText = document.getElementById('search-queries').value.trim();
  const targetVideoCount = parseInt(document.getElementById('video-count').value) || 20;
  
  if (!queriesText) {
    showBatchStatus('Please enter at least one search query.', 'error');
    return;
  }
  
  const queries = queriesText.split('\n')
    .map(q => q.trim())
    .filter(q => q.length > 0);
  
  if (queries.length === 0) {
    showBatchStatus('Please enter valid search queries.', 'error');
    return;
  }
  
  if (targetVideoCount < 1 || targetVideoCount > 100) {
    showBatchStatus('Please enter a video count between 1 and 100.', 'error');
    return;
  }
  
  isBatchRunning = true;
  const startBtn = document.getElementById('start-batch-scrape');
  startBtn.textContent = 'Running...';
  startBtn.disabled = true;
  
  showBatchStatus(`Starting batch scrape for ${queries.length} queries...`, 'info');
  
  // Reload export list to ensure we have the latest data
  await loadExportList();
  
  try {
    let totalCollected = 0;
    let allBatchData = []; // Accumulate all data from all searches
    
    // Get current active tab
    const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!currentTab?.id) {
      throw new Error("No active tab found");
    }
    
    // Navigate to YouTube if not already there
    if (!currentTab.url || !currentTab.url.includes('youtube.com')) {
      await chrome.tabs.update(currentTab.id, { url: 'https://www.youtube.com' });
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
    
    for (let i = 0; i < queries.length; i++) {
      const query = queries[i];
      showBatchStatus(`Processing ${i + 1}/${queries.length}: "${query}" (Target: ${targetVideoCount})`, 'info');
      
      // Create YouTube search URL and navigate current tab
      const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
      await chrome.tabs.update(currentTab.id, { url: searchUrl });
      
      // Wait for page to load
      await new Promise(resolve => setTimeout(resolve, 4000));
      
      try {
        // Inject content script 
        await chrome.scripting.executeScript({
          target: { tabId: currentTab.id },
          files: ["content.js"]
        });
        
        // Wait more for content script to initialize
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Send auto-scroll and scrape command with target count
        showBatchStatus(`Scrolling and fetching data for "${query}"...`, 'info');
        const response = await chrome.tabs.sendMessage(currentTab.id, {
          cmd: "SCROLL_AND_SCRAPE",
          maxItems: targetVideoCount,
          stallRounds: 6,
          delayMs: 2000
        });
        
        if (response && response.ok && response.data) {
          // Add all data to batch accumulator
          allBatchData.push(...response.data);
          
          // Filter out duplicates from entire accumulated batch data and existing export list
          const allExistingVideoIds = new Set([
            ...exportList.map(item => item.videoId),
            ...allBatchData.slice(0, -response.data.length).map(item => item.videoId) // Previous batch data
          ]);
          const newItems = response.data.filter(item => item.videoId && !allExistingVideoIds.has(item.videoId));
          
          if (newItems.length > 0) {
            // Add timestamp and batch query info
            const timestamp = new Date().toISOString();
            const itemsWithTimestamp = newItems.map(item => ({
              ...item,
              addedAt: timestamp,
              batchQuery: query
            }));
            
            // Add to export list
            exportList.push(...itemsWithTimestamp);
            await saveExportList();
            
            // Update the UI count immediately
            document.getElementById("export-items-count").textContent = `Export List: ${exportList.length}`;
          }
          
          const totalItems = response.data.length;
          totalCollected += newItems.length;
          showBatchStatus(`${i + 1}/${queries.length} complete: Found ${totalItems}, added ${newItems.length} new (Total: ${totalCollected})`, 'success');
        } else {
          showBatchStatus(`${i + 1}/${queries.length}: No results found`, 'info');
        }
        
      } catch (error) {
        console.error(`Error processing query "${query}":`, error);
        showBatchStatus(`${i + 1}/${queries.length}: Error - ${error.message}`, 'error');
      }
      
      // Small pause between queries
      if (i < queries.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    // Update currentData with all accumulated batch data for display
    currentData = allBatchData;
    
    // Final UI update - show all batch data in the list
    if (allBatchData.length > 0) {
      displayResults(allBatchData);
    }
    
    document.getElementById("export-items-count").textContent = `Export List: ${exportList.length}`;
    showBatchStatus(`Batch complete! Added ${totalCollected} new videos to export list. Showing all ${allBatchData.length} videos found.`, 'success');
    
  } catch (error) {
    console.error('Batch scrape error:', error);
    showBatchStatus(`Batch scrape failed: ${error.message}`, 'error');
  }
  
  isBatchRunning = false;
  startBtn.textContent = 'Start Batch';
  startBtn.disabled = false;
}
