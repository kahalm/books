// Stacks Dashboard JavaScript

// ============================================================================
// GLOBAL STATE
// ============================================================================

let lastData = "{}";
let lastLog = "{}";
let consoleInterval = null;
const md5Regex = /[a-fA-F0-9]{32}/;
let subdirectoriesTagInput = null;
const fastLimit = { nextSlot: null, fullReset: null }; // daily fast download limit countdown

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function capitalizeFirstLetter(val) {
  return String(val).charAt(0).toUpperCase() + String(val).slice(1);
}

function formatTime(isoString) {
  const date = new Date(isoString);
  return date.toLocaleString();
}

function formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return (bytes / Math.pow(k, i)).toFixed(2) + " " + sizes[i];
}

function colorize(line) {
  const template = document.getElementById("log-line-template");
  const clone = template.content.firstElementChild.cloneNode(true);

  const parts = line.split("] ");
  if (parts.length < 3) {
    clone.querySelector(".log-message").textContent = line;
    return clone;
  }

  const date = parts[0] + "]";
  const level = parts[1] + "]";
  const logger = parts[2] + "]";
  const message = parts.slice(3).join("] ");

  // Fill in template fields
  clone.querySelector(".log-date").textContent = date;
  clone.querySelector(".log-class").textContent = level;
  clone.querySelector(".log-logger").textContent = logger;
  clone.querySelector(".log-message").textContent = message;

  // Add level-specific class
  if (level.includes("[DEBUG")) clone.querySelector(".log-class").classList.add("debug");
  else if (level.includes("[INFO")) clone.querySelector(".log-class").classList.add("info");
  else if (level.includes("[WARNING") || level.includes("[WARN")) clone.querySelector(".log-class").classList.add("warning");
  else if (level.includes("[ERROR")) clone.querySelector(".log-class").classList.add("error");

  return clone;
}

// Extract MD5 from either MD5 string or URL
function extractMD5(input) {
  const match = input.match(md5Regex);
  return match ? match[0].toLowerCase() : null;
}

// ============================================================================
// API HELPER FUNCTIONS
// ============================================================================

function apiHeaders() {
  return {
    "Content-Type": "application/json",
  };
}

function apiFetch(url, options = {}) {
  return fetch(url, {
    ...options,
    credentials: "same-origin", // Always include session cookie
    headers: {
      ...apiHeaders(),
      ...(options.headers || {}),
    },
  });
}

// ============================================================================
// API FUNCTIONS - VERSION & STATUS
// ============================================================================

function getVersion() {
  fetch("/api/version")
    .then((r) => r.json())
    .then((data) => {
      document.getElementById("version").innerHTML = "Version " + data.version;
      document.getElementById("version").classList.add("visible");
    })
    .catch((err) => console.error("Failed to load version:", err));
}

function updateStatus() {
  apiFetch("/api/status")
    .then((r) => {
      if (r.status === 401 || r.status === 403) {
        console.error("Session authentication failed. Status:", r.status);
        window.location.href = "/login";
        throw new Error("Authentication failed - redirecting to login");
      }
      return r.json();
    })
    .then((data) => {
      // Only update when there is a change in data
      const newDataString = JSON.stringify(data);
      if (lastData == newDataString) {
        return;
      } else {
        lastData = newDataString;
      }

      // Update stats
      const successCount = data.recent_history.filter((h) => h.success).length;
      const failCount = data.recent_history.filter((h) => !h.success).length;

      document.getElementById("stat-queue").textContent = data.queue_size;
      document.getElementById("stat-success").textContent = successCount;
      document.getElementById("stat-failed").textContent = failCount;

      // Update fast download stat
      const fastCard = document.getElementById("stat-fast-card");
      if (data.fast_download && data.fast_download.available) {
        const downloadsLeft = data.fast_download.downloads_left;
        const downloadsPerDay = data.fast_download.downloads_per_day;
        if (downloadsLeft !== null && downloadsPerDay !== null) {
          document.getElementById("stat-fast").textContent = `${downloadsLeft}/${downloadsPerDay}`;
          fastLimit.nextSlot = data.fast_download.next_slot ? new Date(data.fast_download.next_slot) : null;
          fastLimit.fullReset = data.fast_download.full_reset ? new Date(data.fast_download.full_reset) : null;
          const parts = [];
          if (fastLimit.nextSlot) parts.push(`Daily limit reached - next download at ${fastLimit.nextSlot.toLocaleString()}`);
          if (fastLimit.fullReset) parts.push(`All ${downloadsPerDay} available again at ${fastLimit.fullReset.toLocaleString()}`);
          parts.push(data.fast_download.source === "annas_archive" ? "Counter from Anna's Archive" : "Local counter");
          fastCard.title = parts.join("\n");
          updateFastLimitTimer();
          fastCard.style.display = "block";
        } else {
          fastCard.style.display = "none";
          fastLimit.nextSlot = fastLimit.fullReset = null;
        }
      } else {
        fastCard.style.display = "none";
        fastLimit.nextSlot = fastLimit.fullReset = null;
      }

      // Update current download
      const currentDiv = document.getElementById("current-download");
      if (data.current) {
        const progress = data.current.progress || {};
        const percent = progress.percent || 0;
        const downloaded = formatBytes(progress.downloaded || 0);
        const total = formatBytes(progress.total_size || 0);

        // Show filename if available, otherwise show MD5
        const displayName = data.current.filename || data.current.md5;
        document.getElementById("current-title").textContent = displayName;
        document.getElementById("current-md5").textContent = data.current.md5;

        // Show subfolder tag if present
        const currentSubfolderEl = document.getElementById("current-subfolder");
        if (data.current.subfolder) {
          currentSubfolderEl.textContent = data.current.subfolder.split("/").pop();
          currentSubfolderEl.style.display = "inline-block";
        } else {
          currentSubfolderEl.style.display = "none";
        }

        // Show status message if available
        const statusEl = document.getElementById("current-status");
        if (data.current.status_message) {
          statusEl.textContent = data.current.status_message;
          statusEl.style.display = "block";
        } else {
          statusEl.style.display = "none";
        }

        document.getElementById("current-progress-bar").style.width = percent + "%";

        // Update progress text spans
        const progressTextEl = document.getElementById("current-progress-text");
        progressTextEl.querySelector(".progress-bytes").textContent = `${downloaded} / ${total}`;
        progressTextEl.querySelector(".progress-percent").textContent = `(${percent.toFixed(1)}%)`;

        // Calculate and display transfer speed
        const speed = progress.speed || 0;
        progressTextEl.querySelector(".progress-speed").textContent = `(${formatBytes(speed)}/s)`;

        currentDiv.style.display = "block";
      } else {
        currentDiv.style.display = "none";
      }

      // lokal (28.10.): alle laufenden Downloads in einem Panel
      renderDownloadsPanel(data.current_downloads || []);

      // Update pause button state
      const pauseBtn = document.getElementById("pause-btn");
      if (data.paused) {
        pauseBtn.title = "Resume downloads";
        pauseBtn.classList.add("btn-success");
        pauseBtn.classList.remove("btn-warning");
        pauseBtn.dataset.icon = "play-circle-line";
      } else {
        pauseBtn.title = "Pause downloads";
        pauseBtn.classList.add("btn-warning");
        pauseBtn.classList.remove("btn-success");
        pauseBtn.dataset.icon = "pause-circle-line";
      }

      // Update queue
      document.getElementById("queue-count").textContent = data.queue_size;
      updateQueueList(data.queue);

      // Update history
      document.getElementById("history-count").textContent = data.recent_history.length;
      updateHistoryList(data.recent_history);
    })
    .catch((err) => console.error("Failed to update status:", err));
}

// ============================================================================
// API FUNCTIONS - CONSOLE/LOGS
// ============================================================================

function updateConsole() {
  apiFetch("/api/logs")
    .then((r) => {
      if (r.status === 401 || r.status === 403) {
        window.location.href = "/login";
        throw new Error("Authentication failed");
      }
      return r.json();
    })
    .then((data) => {
      const box = document.getElementById("console");

      // If nothing changed, skip DOM ops
      const joined = data.lines.join("\n");
      if (joined === lastLog) return;
      lastLog = joined;

      // Clear the container
      box.innerHTML = "";

      // Append each log line as a DOM node
      data.lines.forEach((line) => {
        box.appendChild(colorize(line));
      });

      // Auto-scroll
      box.scrollTop = box.scrollHeight;
    });
}

function activateConsoleTab() {
  // Start polling
  if (!consoleInterval) {
    updateConsole();
    consoleInterval = setInterval(updateConsole, 1000);
  }
}

function deactivateConsoleTab() {
  // Stop polling
  if (consoleInterval) {
    clearInterval(consoleInterval);
    consoleInterval = null;
  }
}

// ============================================================================
// API FUNCTIONS - QUEUE
// ============================================================================

function removeFromQueue(md5) {
  apiFetch("/api/queue/remove", {
    method: "POST",
    body: JSON.stringify({ md5: md5 }),
  })
    .then((r) => r.json())
    .then(() => updateStatus())
    .catch((err) => console.error("Failed to remove item:", err));
}

function clearQueue() {
  apiFetch("/api/queue/clear", { method: "POST" })
    .then((r) => r.json())
    .then(() => updateStatus())
    .catch((err) => console.error("Failed to clear queue:", err));
}

function togglePause() {
  apiFetch("/api/queue/pause", { method: "POST" })
    .then((r) => r.json())
    .then((data) => {
      if (data.success) {
        updateStatus();
        toasts.show({
          title: "Queue Control",
          message: data.message,
          type: "success",
        });
      }
    })
    .catch((err) => console.error("Failed to toggle pause:", err));
}

function cancelCurrent() {
  apiFetch("/api/queue/current/cancel", { method: "POST" })
    .then((r) => r.json())
    .then((data) => {
      if (data.success) {
        updateStatus();
        toasts.show({
          title: "Current Download",
          message: data.message,
          type: "success",
        });
      } else {
        toasts.show({
          title: "Current Download",
          message: data.message,
          type: "error",
        });
      }
    })
    .catch((err) => console.error("Failed to cancel current:", err));
}

function removeCurrent() {
  apiFetch("/api/queue/current/remove", { method: "POST" })
    .then((r) => r.json())
    .then((data) => {
      if (data.success) {
        updateStatus();
        toasts.show({
          title: "Current Download",
          message: data.message,
          type: "success",
        });
      } else {
        toasts.show({
          title: "Current Download",
          message: data.message,
          type: "error",
        });
      }
    })
    .catch((err) => console.error("Failed to remove current:", err));
}

function addDownload() {
  const input = document.getElementById("manual-add");
  const value = input.value.trim();

  if (!value) {
    toasts.show({
      title: "Add Download",
      message: "Please enter an MD5 or URL",
      type: "error",
    });
    return;
  }

  // Extract MD5 from input
  const md5 = extractMD5(value);

  if (!md5) {
    toasts.show({
      title: "Add Download",
      message: "No valid MD5 found in input",
      type: "error",
    });
    return;
  }
  apiFetch("/api/queue/add", {
    method: "POST",
    body: JSON.stringify({
      md5: md5,
      source: "manual",
    }),
  })
    .then((r) => {
      if (r.status === 401 || r.status === 403) {
        throw new Error("Authentication failed. Please refresh the page.");
      }
      if (!r.ok) {
        throw new Error(`HTTP ${r.status}: ${r.statusText}`);
      }
      return r.json();
    })
    .then((data) => {
      if (data.success) {
        toasts.show({
          title: "Add Download",
          message: `Successfully added ${md5} to queue`,
          type: "success",
        });
        input.value = "";
        updateStatus();
      } else {
        toasts.show({
          title: "Add Download",
          message: data.message || "Failed to add to queue",
          type: "error",
        });
      }
    })
    .catch((err) => {
      console.error("Failed to add download:", err);
      toasts.show({
        title: "Add Download",
        message: "Error: " + err.message,
        type: "error",
      });
    });
}

// ============================================================================
// API FUNCTIONS - HISTORY
// ============================================================================

function clearHistory() {
  apiFetch("/api/history/clear", { method: "POST" })
    .then((r) => r.json())
    .then(() => updateStatus())
    .catch((err) => console.error("Failed to clear history:", err));
}

function retryFailed(md5) {
  apiFetch("/api/history/retry", {
    method: "POST",
    body: JSON.stringify({ md5: md5 }),
  })
    .then((r) => r.json())
    .then((data) => {
      if (data.success) {
        updateStatus();
      } else {
        toasts.show({
          title: "Retry",
          message: data.message || "Failed to retry",
          type: "error",
        });
      }
    })
    .catch((err) => console.error("Failed to retry download:", err));
}

function removeFromHistory(md5) {
  apiFetch("/api/history/remove", {
    method: "POST",
    body: JSON.stringify({ md5: md5 }),
  })
    .then((r) => r.json())
    .then((data) => {
      if (data.success) {
        updateStatus();
      } else {
        toasts.show({
          title: "History",
          message: data.message || "Failed to remove item",
          type: "error",
        });
      }
    })
    .catch((err) => console.error("Failed to remove history item:", err));
}

// ============================================================================
// API FUNCTIONS - SETTINGS
// ============================================================================

function loadSettings() {
  // Load and display API keys
  apiFetch("/api/key")
    .then((r) => r.json())
    .then((data) => {
      // Handle downloader key (may be null if disabled)
      const downloaderKeyInput = document.getElementById("display-downloader-key");
      if (data.downloader_key) {
        downloaderKeyInput.value = data.downloader_key;
      } else {
        downloaderKeyInput.value = "Disabled (click Generate New to enable)";
      }

      // Handle admin key (may be null if disabled)
      const apiKeyInput = document.getElementById("display-api-key");
      if (data.api_key) {
        apiKeyInput.value = data.api_key;
      } else {
        apiKeyInput.value = "Disabled (click Generate New to enable)";
      }
    })
    .catch((err) => {
      console.error("Failed to load API keys:", err);
      document.getElementById("display-api-key").value = "Error loading key";
      document.getElementById("display-downloader-key").value = "Error loading key";
    });

  apiFetch("/api/config")
    .then((r) => r.json())
    .then((config) => {
      // Login credentials
      document.getElementById("setting-authentication-enabled").checked = !config.login?.disable;
      document.getElementById("setting-username").value = config.login?.username || "";
      document.getElementById("setting-new-password").value = "";

      // Downloads
      document.getElementById("setting-delay").value = config.downloads?.delay || 2;
      document.getElementById("setting-retry-count").value = config.downloads?.retry_count || 3;
      document.getElementById("setting-resume-attempts").value = config.downloads?.resume_attempts || 3;
      document.getElementById("setting-incomplete-folder-path").value = config.downloads?.incomplete_folder_path || "/download/incomplete";
      document.getElementById("setting-prefer-title-naming").checked = !!config.downloads?.prefer_title_naming;
      document.getElementById("setting-include-hash").value = config.downloads?.include_hash || "none";

      // Subdirectories (use tag input component)
      const subdirs = config.downloads?.subdirectories || [];
      if (subdirectoriesTagInput) {
        subdirectoriesTagInput.setTags(Array.isArray(subdirs) ? subdirs : []);
      }

      // Fast Download
      document.getElementById("setting-fast-enabled").checked = !!config.fast_download?.enabled;
      document.getElementById("setting-fast-key").value = config.fast_download?.key || "";
      document.getElementById("setting-fast-daily-limit").value = config.fast_download?.daily_limit ?? 50;

      // FlareSolverr
      document.getElementById("setting-flaresolverr-enabled").checked = !!config.flaresolverr?.enabled;
      document.getElementById("setting-flaresolverr-url").value = config.flaresolverr?.url || "http://localhost:8191";
      document.getElementById("setting-flaresolverr-timeout").value = config.flaresolverr?.timeout || 60;

      // Proxy
      document.getElementById("setting-proxy-enabled").checked = !!config.proxy?.enabled;
      document.getElementById("setting-proxy-url").value = config.proxy?.url || "";
      document.getElementById("setting-proxy-username").value = config.proxy?.username || "";
      document.getElementById("setting-proxy-password").value = config.proxy?.password || "";

      // Queue
      document.getElementById("setting-max-history").value = config.queue?.max_history || 100;

      // Logging
      document.getElementById("setting-log-level").value = config.logging?.level || "WARNING";
    })
    .catch((err) => console.error("Failed to load settings:", err));
}

function saveSettings() {
  const newPassword = document.getElementById("setting-new-password").value;

  // Get subdirectories from tag input component
  const subdirectories = subdirectoriesTagInput ? subdirectoriesTagInput.getTags() : null;

  const config = {
    downloads: {
      delay: parseInt(document.getElementById("setting-delay").value),
      retry_count: parseInt(document.getElementById("setting-retry-count").value),
      resume_attempts: parseInt(document.getElementById("setting-resume-attempts").value),
      incomplete_folder_path: document.getElementById("setting-incomplete-folder-path").value,
      prefer_title_naming: document.getElementById("setting-prefer-title-naming").checked,
      include_hash: document.getElementById("setting-include-hash").value,
      subdirectories: subdirectories,
    },
    fast_download: {
      enabled: document.getElementById("setting-fast-enabled").checked,
      key: document.getElementById("setting-fast-key").value || null,
      daily_limit: Math.max(0, parseInt(document.getElementById("setting-fast-daily-limit").value) || 0),
    },
    flaresolverr: {
      enabled: document.getElementById("setting-flaresolverr-enabled").checked,
      url: document.getElementById("setting-flaresolverr-url").value || "http://localhost:8191",
      timeout: parseInt(document.getElementById("setting-flaresolverr-timeout").value) || 60,
    },
    proxy: {
      enabled: document.getElementById("setting-proxy-enabled").checked,
      url: document.getElementById("setting-proxy-url").value || null,
      username: document.getElementById("setting-proxy-username").value || null,
      password: document.getElementById("setting-proxy-password").value || null,
    },
    queue: {
      max_history: parseInt(document.getElementById("setting-max-history").value),
    },
    logging: {
      level: document.getElementById("setting-log-level").value,
    },
    login: {
      username: document.getElementById("setting-username").value,
      disable: !document.getElementById("setting-authentication-enabled").checked,
    },
  };

  // Only include password if it's been changed
  if (newPassword) {
    config.login.new_password = newPassword;
  }

  apiFetch("/api/config", {
    method: "POST",
    body: JSON.stringify(config),
  })
    .then((r) => {
      if (r.status === 401 || r.status === 403) {
        throw new Error("Session authentication failed. Please refresh the page.");
      }
      if (!r.ok) {
        throw new Error(`HTTP ${r.status}: ${r.statusText}`);
      }
      return r.json();
    })
    .then((data) => {
      if (data.success) {
        if (newPassword) {
          toasts.show({
            title: "Settings",
            message: "Settings saved successfully! Your password has been updated. Changes are now active.",
            type: "success",
          });
        } else {
          toasts.show({
            title: "Settings",
            message: "Settings saved successfully! Changes are now active.",
            type: "success",
          });
        }
        document.getElementById("setting-new-password").value = "";
      } else {
        toasts.show({
          title: "Settings",
          message: "Failed to save settings: " + (data.error || "Unknown error"),
          type: "error",
        });
      }
    })
    .catch((err) => {
      console.error("Failed to save settings:", err);
      toasts.show({
        title: "Settings",
        message: "Failed to save settings: " + err.message,
        type: "error",
      });
    });
}

function regenerateApiKey(type) {
  if (type == "admin") url = "/api/key/regenerate";
  else if (type == "downloader") url = "/api/key/downloader/regenerate";
  else return;
  const fieldId = type === "admin" ? "display-api-key" : "display-downloader-key";
  
  apiFetch(url, {
    method: "POST",
  })
    .then((r) => r.json())
    .then((data) => {
      if (data.success) {
        const keyValue = type === "admin" ? data.api_key : data.downloader_key;
        document.getElementById(fieldId).value = keyValue;
        toasts.show({
          title: capitalizeFirstLetter(type) + " API Key",
          message: "New " + type + " API key generated!",
          type: "success",
        });
      } else {
        toasts.show({
          title: capitalizeFirstLetter(type) + " API Key",
          message: "Failed to regenerate API key: " + (data.error || "Unknown error"),
          type: "error",
        });
      }
    })
    .catch((err) => {
      console.error("Failed to regenerate API key:", err);
      toasts.show({
        title: capitalizeFirstLetter(type) + " API Key",
        message: "Failed to regenerate API key: " + err.message,
        type: "error",
      });
    });
}

function disableApiKey(type) {
  if (type == "admin") url = "/api/key/disable";
  else if (type == "downloader") url = "/api/key/downloader/disable";
  else return;
  const fieldId = type === "admin" ? "display-api-key" : "display-downloader-key";
  apiFetch(url, {
    method: "POST",
  })
    .then((r) => r.json())
    .then((data) => {
      if (data.success) {
        document.getElementById(fieldId).value = "Disabled (click Generate New to enable)";
        toasts.show({
          title: capitalizeFirstLetter(type) + " API Key",
          message: capitalizeFirstLetter(type) + " API key has been disabled.",
          type: "success",
        });
      } else {
        toasts.show({
          title: capitalizeFirstLetter(type) + " API Key",
          message: "Failed to disable " + type + " key: " + (data.error || "Unknown error"),
          type: "error",
        });
      }
    })
    .catch((err) => {
      console.error("Failed to disable " + type + " key:", err);
      toasts.show({
        title: capitalizeFirstLetter(type) + " API Key",
        message: "Failed to disable " + type + " key: " + err.message,
        type: "error",
      });
    });
}

function testFastKey() {
  const key = document.getElementById("setting-fast-key").value;
  const resultDiv = document.getElementById("key-test-result");

  if (!key) {
    resultDiv.className = "test-result error";
    resultDiv.textContent = "Please enter a key first";
    return;
  }

  resultDiv.className = "test-result";
  resultDiv.textContent = "Testing key...";
  resultDiv.style.display = "block";

  apiFetch("/api/config/test_key", {
    method: "POST",
    body: JSON.stringify({ key: key }),
  })
    .then((r) => r.json())
    .then((data) => {
      if (data.success) {
        resultDiv.className = "test-result success";
        const icon = document.createElement("span");
        icon.setAttribute("data-icon", "check");
        resultDiv.textContent = ` Key is valid! Downloads available: ${data.downloads_left}/${data.downloads_per_day}`;
        resultDiv.prepend(icon);
      } else {
        resultDiv.className = "test-result error";
        const icon = document.createElement("span");
        icon.setAttribute("data-icon", "close");
        resultDiv.textContent = ` ${data.error}`;
        resultDiv.prepend(icon);
      }
    })
    .catch((err) => {
      resultDiv.className = "test-result error";
      const icon = document.createElement("span");
      icon.setAttribute("data-icon", "close");
      resultDiv.textContent = ` Connection error: ${err.message}`;
      resultDiv.prepend(icon);
    });
}

function testFlaresolverr() {
  const url = document.getElementById("setting-flaresolverr-url").value;
  const timeout = parseInt(document.getElementById("setting-flaresolverr-timeout").value) || 10;
  const resultDiv = document.getElementById("flaresolverr-test-result");

  if (!url) {
    resultDiv.className = "test-result error";
    resultDiv.textContent = "Please enter a FlareSolverr URL first";
    return;
  }

  resultDiv.className = "test-result";
  resultDiv.textContent = "Testing connection...";
  resultDiv.style.display = "block";

  apiFetch("/api/config/test_flaresolverr", {
    method: "POST",
    body: JSON.stringify({ url: url, timeout: timeout }),
  })
    .then((r) => r.json())
    .then((data) => {
      if (data.success) {
        resultDiv.className = "test-result success";
        const icon = document.createElement("span");
        icon.setAttribute("data-icon", "check");
        resultDiv.textContent = ` ${data.message}`;
        resultDiv.prepend(icon);
      } else {
        resultDiv.className = "test-result error";
        const icon = document.createElement("span");
        icon.setAttribute("data-icon", "close");
        resultDiv.textContent = ` ${data.error}`;
        resultDiv.prepend(icon);
      }
    })
    .catch((err) => {
      resultDiv.className = "test-result error";
      const icon = document.createElement("span");
      icon.setAttribute("data-icon", "close");
      resultDiv.textContent = ` Connection error: ${err.message}`;
      resultDiv.prepend(icon);
    });
}

function testProxy() {
  const url = document.getElementById("setting-proxy-url").value;
  const username = document.getElementById("setting-proxy-username").value;
  const password = document.getElementById("setting-proxy-password").value;
  const resultDiv = document.getElementById("proxy-test-result");

  if (!url) {
    resultDiv.className = "test-result error";
    resultDiv.textContent = "Please enter a proxy URL first";
    resultDiv.style.display = "block";
    return;
  }

  resultDiv.className = "test-result";
  resultDiv.textContent = "Testing connection...";
  resultDiv.style.display = "block";

  apiFetch("/api/config/test_proxy", {
    method: "POST",
    body: JSON.stringify({ url: url, username: username || null, password: password || null }),
  })
    .then((r) => r.json())
    .then((data) => {
      if (data.success) {
        resultDiv.className = "test-result success";
        const icon = document.createElement("span");
        icon.setAttribute("data-icon", "check");
        resultDiv.textContent = ` ${data.message}`;
        resultDiv.prepend(icon);
      } else {
        resultDiv.className = "test-result error";
        const icon = document.createElement("span");
        icon.setAttribute("data-icon", "close");
        resultDiv.textContent = ` ${data.error}`;
        resultDiv.prepend(icon);
      }
    })
    .catch((err) => {
      resultDiv.className = "test-result error";
      const icon = document.createElement("span");
      icon.setAttribute("data-icon", "close");
      resultDiv.textContent = ` Connection error: ${err.message}`;
      resultDiv.prepend(icon);
    });
}

// ============================================================================
// UI UPDATE FUNCTIONS
// ============================================================================

function updateQueueList(queue) {
  const queueList = document.getElementById("queue-list");

  if (queue.length === 0) {
    queueList.innerHTML = document.getElementById("queue-empty-template").innerHTML;
    return;
  }

  // Clear list
  queueList.innerHTML = "";

  // Get template
  const template = document.getElementById("queue-item-template");

  // Add each item
  queue.forEach((item) => {
    const clone = template.content.cloneNode(true);

    // Title: prefer title, then filename, fall back to MD5
    const displayName = item.title || item.filename || item.md5;
    clone.querySelector(".item-title-text").textContent = displayName;

    // MD5 always shown below the title
    clone.querySelector(".item-md5").textContent = item.md5;
    clone.querySelector(".item-time").textContent = "Added: " + formatTime(item.added_at);

    // File type badge from filename extension
    const filetypeTag = clone.querySelector(".item-filetype");
    const nameForExt = item.filename || item.title || "";
    const dotIdx = nameForExt.lastIndexOf(".");
    if (dotIdx !== -1 && dotIdx < nameForExt.length - 1) {
      filetypeTag.textContent = nameForExt.slice(dotIdx + 1).toUpperCase();
      filetypeTag.style.display = "inline";
    }

    // Status badge for items not yet ready to download
    const statusTag = clone.querySelector(".item-status");
    if (item.status === "pending_scrape" || item.status === "scraping") {
      statusTag.textContent = "Fetching info...";
      statusTag.style.display = "inline";
    }

    // Subfolder tag
    const subfolderTag = clone.querySelector(".item-subfolder");
    if (item.subfolder) {
      subfolderTag.textContent = item.subfolder.split("/").pop();
      subfolderTag.style.display = "inline-block";
    }

    const removeBtn = clone.querySelector(".btn-danger");
    removeBtn.onclick = () => removeFromQueue(item.md5);

    queueList.appendChild(clone);
  });
}

function updateHistoryList(history) {
  const historyList = document.getElementById("history-list");

  if (history.length === 0) {
    historyList.innerHTML = document.getElementById("history-empty-template").innerHTML;
    return;
  }

  // Clear list
  historyList.innerHTML = "";

  // Get template
  const template = document.getElementById("history-item-template");

  // Add each item
  history.forEach((item) => {
    const clone = template.content.cloneNode(true);

    // Status icon (success vs failed)
    const statusIcon = clone.querySelector(".item-status-icon");
    if (item.success) {
      statusIcon.setAttribute("data-icon", "check");
      statusIcon.className = "item-status-icon success-icon";
    } else {
      statusIcon.setAttribute("data-icon", "close");
      statusIcon.className = "item-status-icon error-icon";
    }
    clone.querySelector(".item-link").href = "/aa/md5/" + item.md5;
    // Title - filename or MD5
    const displayName = item.filename || item.md5;
    clone.querySelector(".item-title-text").textContent = displayName;

    // Method icon (fast vs mirror)
    const methodIcon = clone.querySelector(".item-method-icon");

    if (item.success && item.used_fast_download) {
      methodIcon.setAttribute("data-icon", "speed-up");
      methodIcon.title = "Fast";
    } else if (item.success) {
      methodIcon.setAttribute("data-icon", "slow-down");
      methodIcon.title = "Mirror";
    } else {
      methodIcon.removeAttribute("data-icon");
    }

    // Show subfolder tag if present
    const subfolderTag = clone.querySelector(".item-subfolder");
    if (item.subfolder) {
      subfolderTag.textContent = item.subfolder.split("/").pop();
      subfolderTag.style.display = "inline-block";
    }

    // MD5 + timestamp
    clone.querySelector(".item-md5").textContent = item.md5;
    clone.querySelector(".item-time").textContent = formatTime(item.completed_at);

    // Error message
    if (item.error) {
      const errorDiv = clone.querySelector(".item-error");
      errorDiv.textContent = item.error;
      errorDiv.style.display = "block";
    }

    // Retry button
    if (!item.success) {
      clone.querySelector(".history-actions").classList.add("visible");
      const retryBtn = clone.querySelector(".retry-btn");
      retryBtn.style.display = "inline-block";
    }

    historyList.appendChild(clone);
  });
}

// ============================================================================
// EVENT HANDLERS & INITIALIZATION
// ============================================================================

// Global click handler for retry buttons (event delegation for firefox)
document.addEventListener('click', (event) => {
  const retryBtn = event.target.closest('.retry-btn');
  const removeBtn = event.target.closest('.remove-history-btn');
  if (!retryBtn && !removeBtn) return;

  const listItem = (retryBtn || removeBtn).closest('.list-item');
  const md5El = listItem?.querySelector('.item-md5');
  const md5 = md5El?.textContent?.trim();

  if (md5) {
    if (retryBtn) {
      retryFailed(md5);
    } else {
      removeFromHistory(md5);
    }
  } else {
    console.error('History action clicked but MD5 could not be found');
  }
});

// Tab switching
document.querySelectorAll(".tab-button").forEach((button) => {
  button.addEventListener("click", () => {
    const tabName = button.dataset.tab;

    // Update buttons
    document.querySelectorAll(".tab-button").forEach((btn) => btn.classList.remove("active"));
    button.classList.add("active");

    // Update content
    document.querySelectorAll(".tab-content").forEach((content) => content.classList.remove("active"));
    document.getElementById(`${tabName}-tab`).classList.add("active");

    // Load settings when switching to settings tab
    if (tabName === "settings") {
      loadSettings();
    } else if (tabName === "console") {
      updateConsole();
    }
  });
});

// Settings navigation switching
document.querySelectorAll(".settings-nav li").forEach((item, index) => {
  item.addEventListener("click", () => {
    const settingName = item.textContent.toLowerCase();

    // Update nav items
    document.querySelectorAll(".settings-nav li").forEach((li) => li.classList.remove("active"));
    item.classList.add("active");

    // Update content sections
    document.querySelectorAll(".settings-content").forEach((content) => content.classList.remove("active"));
    document.querySelector(`.settings-content[data-setting="${settingName}"]`)?.classList.add("active");
  });

  // Set first item as active on load
  if (index === 0) {
    item.classList.add("active");
    document.querySelector(`.settings-content[data-setting="${item.textContent.toLowerCase()}"]`)?.classList.add("active");
  }
});

// Add download button handler
document.querySelector(".add-item .btn-success").addEventListener("click", addDownload);

// Add download on Enter key
document.getElementById("manual-add").addEventListener("keypress", (e) => {
  if (e.key === "Enter") {
    addDownload();
  }
});

// Console tab polling (legacy interval)
setInterval(() => {
  const consoleTab = document.getElementById("console-tab");
  if (consoleTab && consoleTab.classList.contains("active")) {
    updateConsole();
  }
}, 1000);

// Clipboard initialization
document.addEventListener("DOMContentLoaded", () => {
  const clipboard = new ClipboardJS('[data-clipboard-action="copy"]');
  clipboard.on("success", function (e) {
    e.clearSelection();
  });

  // Initialize tag input component for subdirectories
  subdirectoriesTagInput = new TagInput("setting-subdirectories", {
    placeholder: "Add subdirectory...",
    allowDuplicates: false,
    countLabel: "subdirectories",
    countLabelSingular: "subdirectory",
  });
});

// Initialize and start polling
updateStatus();
getVersion();
setInterval(updateStatus, 2000);

// Countdown for the daily fast download limit (ticks between status polls)
function formatCountdown(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
}

function updateFastLimitTimer() {
  const el = document.getElementById("stat-fast-timer");
  if (!el) return;
  const now = Date.now();
  if (fastLimit.nextSlot && fastLimit.nextSlot > now) {
    el.textContent = `Next in ${formatCountdown(fastLimit.nextSlot - now)}`;
  } else if (fastLimit.fullReset && fastLimit.fullReset > now) {
    el.textContent = `Reset in ${formatCountdown(fastLimit.fullReset - now)}`;
  } else {
    el.textContent = "";
  }
}

setInterval(updateFastLimitTimer, 1000);


// ============================================================================
// lokal (28.10.): Download-Panel mit ETA, Gesamtgeschwindigkeit und 24-h-Graph
// ============================================================================

function formatEta(seconds) {
  if (!isFinite(seconds) || seconds <= 0) return "–";
  seconds = Math.round(seconds);
  if (seconds < 60) return `${seconds} s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m} min ${seconds % 60} s`;
  const h = Math.floor(m / 60);
  return `${h} h ${m % 60} min`;
}

function renderDownloadsPanel(downloads) {
  const panel = document.getElementById("downloads-panel");
  if (!panel) return;
  const total = downloads.reduce((s, d) => s + ((d.progress || {}).speed || 0), 0);
  document.getElementById("dl-heading").textContent = `Downloads (${downloads.length})`;
  document.getElementById("dl-total").textContent = `Gesamt ${formatBytes(total)}/s`;
  document.getElementById("dl-list").replaceChildren(
    ...downloads.map((d, i) => {
      const p = d.progress || {};
      const pct = p.percent || 0;
      const speed = p.speed || 0;
      const rest = (p.total_size || 0) - (p.downloaded || 0);
      const eta = p.total_size && speed > 0 ? formatEta(rest / speed) : "–";
      const row = document.createElement("div");
      row.className = "dl-row";
      const line = document.createElement("div");
      line.className = "dl-line";
      const title = document.createElement("div");
      title.className = "dl-title";
      title.textContent = d.filename || d.md5;
      title.title = d.filename || d.md5;
      const meta = document.createElement("div");
      meta.className = "dl-meta";
      meta.textContent = `${formatBytes(p.downloaded || 0)} / ${p.total_size ? formatBytes(p.total_size) : "?"} · ${pct.toFixed(1)}% · ${formatBytes(speed)}/s · ETA ${eta}`;
      line.append(title, meta);
      if (i === 0) {
        // Die API kann nur den ersten laufenden Download pausieren/abbrechen
        const actions = document.createElement("div");
        actions.className = "dl-actions";
        actions.innerHTML =
          '<button class="btn btn-primary" onclick="cancelCurrent()" title="Pause download">⏸</button>' +
          '<button class="btn btn-danger" onclick="removeCurrent()" title="Cancel and remove">✕</button>';
        line.append(actions);
      }
      const sub = document.createElement("div");
      sub.className = "dl-sub";
      sub.textContent = [d.status_message, d.md5].filter(Boolean).join(" · ");
      const bar = document.createElement("div");
      bar.className = "dl-bar";
      const fill = document.createElement("div");
      fill.style.width = pct + "%";
      bar.append(fill);
      row.append(line, sub, bar);
      return row;
    })
  );
  panel.style.display = downloads.length ? "block" : "none";
}

let speedHistoryAt = 0;
function updateSpeedGraph(force) {
  if (!force && Date.now() - speedHistoryAt < 60000) return;
  speedHistoryAt = Date.now();
  apiFetch("/api/speed_history")
    .then((r) => r.json())
    .then((h) => drawSpeedGraph(h))
    .catch((err) => console.error("Failed to load speed history:", err));
}

let speedGraphSlice = null; // lokal (28.10.): Beginn des angeklickten 30-min-Balkens (ms)

function drawSpeedGraph(h) {
  const svg = document.getElementById("speed-svg");
  if (!svg) return;
  const W = 1000, H = 140, top = 6, bottom = 16;
  const end = new Date(h.now || Date.now()).getTime();
  const start = end - (h.hours || 24) * 3600 * 1000;
  const x = (t) => ((t - start) / (end - start)) * W;
  const samples = (h.samples || []).map(([ts, v]) => [new Date(ts).getTime(), v]);
  const maxV = Math.max(1, ...samples.map((s) => s[1]));
  const done = (h.completed || []).map(([ts, n]) => [new Date(ts).getTime(), n]);
  const maxN = Math.max(1, ...done.map((d) => d[1]));
  const yV = (v) => H - bottom - (v / maxV) * (H - bottom - top);
  const yN = (n) => H - bottom - (n / maxN) * (H - bottom - top);
  const ns = "http://www.w3.org/2000/svg";
  const el = (tag, attrs, text) => {
    const e = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (text) e.textContent = text;
    return e;
  };
  const parts = [];
  // Stundenraster mit Uhrzeit alle 3 h
  for (let t = Math.ceil(start / 3600000) * 3600000; t <= end; t += 3600000) {
    const d = new Date(t);
    parts.push(el("line", { x1: x(t), x2: x(t), y1: top, y2: H - bottom, stroke: "rgba(255,255,255,0.07)" }));
    if (d.getHours() % 3 === 0)
      parts.push(el("text", { x: x(t) + 2, y: H - 3, fill: "rgba(255,255,255,0.55)", "font-size": 11 }, `${d.getHours()}:00`));
  }
  // fertige Bücher je 30 min als Balken; Klick zeigt Anzahl + Ø-Geschwindigkeit des Abschnitts
  const slice = 1800 * 1000;
  const bw = (slice / (end - start)) * W;
  const hm = (t) => { const d = new Date(t); return `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`; };
  const sliceInfo = (t, n) => {
    const v = samples.filter(([st]) => st >= t && st < t + slice).map((s) => s[1]);
    const avg = v.length ? `Ø ${formatBytes(v.reduce((a, b) => a + b, 0) / v.length)}/s` : "keine Geschwindigkeitsmessung";
    return `${hm(t)}–${hm(t + slice)}: ${n} ${n === 1 ? "Buch" : "Bücher"} fertig · ${avg}`;
  };
  if (!done.some(([t]) => t === speedGraphSlice)) speedGraphSlice = null;
  for (const [t, n] of done)
    parts.push(el("rect", { x: x(t), y: yN(n), width: Math.max(bw - 1, 1), height: H - bottom - yN(n),
      fill: t === speedGraphSlice ? "rgba(139,233,253,0.8)" : "rgba(139,233,253,0.35)" }));
  // Geschwindigkeit als Fläche + Linie; Lücken > 3 min trennen die Kurve
  if (samples.length) {
    let segs = [[samples[0]]];
    for (let i = 1; i < samples.length; i++) {
      if (samples[i][0] - samples[i - 1][0] > 180000) segs.push([]);
      segs[segs.length - 1].push(samples[i]);
    }
    for (const seg of segs) {
      const pts = seg.map(([t, v]) => `${x(t).toFixed(1)},${yV(v).toFixed(1)}`).join(" ");
      const x0 = x(seg[0][0]).toFixed(1), x1 = x(seg[seg.length - 1][0]).toFixed(1);
      parts.push(el("polygon", { points: `${x0},${H - bottom} ${pts} ${x1},${H - bottom}`, fill: "rgba(80,250,123,0.18)" }));
      parts.push(el("polyline", { points: pts, fill: "none", stroke: "#50fa7b", "stroke-width": 1.5, "vector-effect": "non-scaling-stroke" }));
    }
  }
  // Klickflächen über die volle Höhe, über der Kurve (flache Balken sonst kaum zu treffen)
  for (const [t, n] of done) {
    const hit = el("rect", { x: x(t), y: top, width: Math.max(bw, 2), height: H - bottom - top, fill: "transparent", style: "cursor: pointer" });
    hit.append(el("title", {}, sliceInfo(t, n)));
    hit.addEventListener("click", () => {
      speedGraphSlice = speedGraphSlice === t ? null : t;
      drawSpeedGraph(h);
    });
    parts.push(hit);
  }
  parts.push(el("text", { x: 4, y: top + 10, fill: "#50fa7b", "font-size": 11 }, `max ${formatBytes(maxV)}/s`));
  parts.push(el("text", { x: W - 4, y: top + 10, fill: "rgba(139,233,253,0.9)", "font-size": 11, "text-anchor": "end" }, `max ${maxN} Bücher/30 min`));
  svg.replaceChildren(...parts);
  const nDone = done.reduce((s, d) => s + d[1], 0);
  const avg = samples.length ? samples.reduce((s, v) => s + v[1], 0) / samples.length : 0;
  document.getElementById("speed-graph-info").textContent =
    `24 h: ${nDone} Bücher fertig · Ø ${formatBytes(avg)}/s` + (samples.length < 60 ? " · Geschwindigkeit wird erst seit dem Update aufgezeichnet" : "");
  const sel = done.find(([t]) => t === speedGraphSlice);
  document.getElementById("speed-graph-slice").textContent = sel ? sliceInfo(sel[0], sel[1]) : "";
}

// lokal (28.10.): 24-h-Graph der Gesamtgeschwindigkeit, jede Minute neu (erst hier: speedHistoryAt ist ein let weiter oben)
updateSpeedGraph(true);
setInterval(() => updateSpeedGraph(false), 15000);
