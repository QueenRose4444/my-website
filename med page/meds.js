/*************************************
 * Global Settings & Helper Functions
 *************************************/

// Load default settings from localStorage or use defaults
let userSettings = {
  dateFormat: localStorage.getItem("dateFormat") || "dd/mm/yyyy",
  timeFormat: localStorage.getItem("timeFormat") || "12hr",
  weekStart: localStorage.getItem("weekStart") || "Sunday" // New setting for week start day
};

// Mapping objects to convert user setting formats into flatpickr tokens
const flatpickrDateFormatMapping = {
  "dd/mm/yyyy": "d/m/Y",
  "mm/dd/yyyy": "m/d/Y",
  "yyyy/mm/dd": "Y/m/d"
};

const flatpickrTimeFormatMapping = {
  "12hr": "h:i K",
  "24hr": "H:i"
};

// Helper function to format Date objects based on userSettings.dateFormat
function formatDate(date) {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  switch (userSettings.dateFormat) {
    case "mm/dd/yyyy":
      return `${month}/${day}/${year}`;
    case "yyyy/mm/dd":
      return `${year}/${month}/${day}`;
    case "dd/mm/yyyy":
    default:
      return `${day}/${month}/${year}`;
  }
}

// Helper function to format graph labels (for month and 90days views)
// Pads both day and month to two digits and outputs in order per the user's setting.
// For "dd/mm/yyyy", returns "dd/mm"; for "mm/dd/yyyy" or "yyyy/mm/dd", returns "mm/dd".
function formatGraphLabel(date) {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  if (userSettings.dateFormat === "dd/mm/yyyy") {
    return `${day}/${month}`;
  } else {
    return `${month}/${day}`;
  }
}

// Helper function to format Date objects based on userSettings.timeFormat
function formatTime(date) {
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: userSettings.timeFormat === "12hr"
  });
}

// Function to update flatpickr formats if settings change
function updateFlatpickrFormats() {
  datePicker.set("dateFormat", flatpickrDateFormatMapping[userSettings.dateFormat]);
  timePicker.set("dateFormat", flatpickrTimeFormatMapping[userSettings.timeFormat]);
}

/***********************
 * Data & DOM Elements
 ***********************/

const medicationData = {
  mounjaro: {halfLife: 120, timeToPeak: 48},
  // template
  // med: {halfLife: num, timeToPeak: num},
};

const elements = {
  medicationSelect: document.getElementById("medication"),
  doseSelect: document.getElementById("dose"),
  dateInput: document.getElementById("date"),
  timeInput: document.getElementById("time"),
  saveShotButton: document.getElementById("saveShot"),
  chartCanvas: document.getElementById("medicationChart"),
  graphViewSelect: document.getElementById("graphViewSelect"),
  shotHistoryButton: document.getElementById("shotHistory"),
  modal: document.getElementById("shotHistoryModal")
};

// Retrieve shot history from localStorage
let shotHistory = JSON.parse(localStorage.getItem("shotHistory") || "[]");

/************************************
 * Flatpickr Initialization (Main)
 ************************************/

const datePicker = flatpickr(elements.dateInput, {
  dateFormat: flatpickrDateFormatMapping[userSettings.dateFormat],
  defaultDate: "today"
});

const timePicker = flatpickr(elements.timeInput, {
  enableTime: true,
  noCalendar: true,
  dateFormat: flatpickrTimeFormatMapping[userSettings.timeFormat],
  defaultDate: new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: userSettings.timeFormat === "12hr"
  })
});

/*********************
 * Chart Initialization
 *********************/
let medicationChart;

function createChart(data) {
  // If no data exists, set a default placeholder dataset
  if (!data.labels.length) {
    data.labels = ["No Data"];
    data.values = [0];
    data.timestamps = [new Date()];
  }
  
  if (medicationChart) medicationChart.destroy();

  medicationChart = new Chart(elements.chartCanvas, {
    type: "line",
    data: {
      labels: data.labels,
      // Attach the timestamps array to the chart config for tooltip callbacks
      datasets: [{
        label: "Medication Level",
        data: data.values,
        borderColor: "#4bc0c0",
        tension: 0.4
      }],
      timestamps: data.timestamps
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        tooltip: {
          callbacks: {
            // Use the timestamps array to create a custom title for the tooltip
            title: function(context) {
              const index = context[0].dataIndex;
              const ts = medicationChart.data.timestamps[index];
              return `${formatDate(ts)} ${formatTime(ts)}`;
            },
            label: function(context) {
              let value = context.parsed.y;
              return `Level: ${value.toFixed(2)}mg`;
            }
          }
        }
      },
      scales: {
        x: {
          ticks: {
            callback: (value, index) => {
              const view = elements.graphViewSelect.value;
              const totalDays = Math.ceil(data.labels.length / 24);
              switch (view) {
                case "week":
                  return index % 24 === 0 ? data.labels[index] : "";
                case "month":
                case "90days":
                  return index % (5 * 24) === 0 ? data.labels[index] : "";
                case "alltime":
                  if (totalDays <= 30) return index % 24 === 0 ? data.labels[index] : "";
                  if (totalDays <= 180) return index % (7 * 24) === 0 ? data.labels[index] : "";
                  return index % (30 * 24) === 0 ? data.labels[index] : "";
                default:
                  return data.labels[index];
              }
            },
            autoSkip: false,
            maxRotation: 0
          }
        },
        y: {
          beginAtZero: true,
          ticks: {
            callback: value => `${value.toFixed(2)}mg`
          }
        }
      }
    }
  });
}

/*****************************
 * Medication Level Calculation
 *****************************/
function calculateMedicationLevels(shotHistory, graphView) {
  // If no shots, return empty arrays
  if (shotHistory.length === 0) return { labels: [], values: [], timestamps: [] };

  const now = new Date();
  let startDate, endDate;

  switch (graphView) {
    case "week": {
      // For week view, calculate startDate based on userSettings.weekStart
      const weekDays = {
        "Sunday": 0,
        "Monday": 1,
        "Tuesday": 2,
        "Wednesday": 3,
        "Thursday": 4,
        "Friday": 5,
        "Saturday": 6
      };
      const desiredStart = weekDays[userSettings.weekStart];
      startDate = new Date(now);
      // Adjust startDate backward to the most recent desiredStart day
      let currentDay = startDate.getDay();
      let diff = (currentDay - desiredStart + 7) % 7;
      startDate.setDate(startDate.getDate() - diff);
      startDate.setHours(0, 0, 0, 0);
      // End date is 6 days later, set to end of day
      endDate = new Date(startDate);
      endDate.setDate(startDate.getDate() + 6);
      endDate.setHours(23, 59, 59, 999);
      break;
    }
    case "month":
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      break;
    case "90days":
      startDate = new Date(now);
      startDate.setDate(now.getDate() - 30);
      endDate = new Date(now);
      endDate.setDate(now.getDate() + 60);
      break;
    case "alltime": {
      startDate = new Date(shotHistory[shotHistory.length - 1].dateTime);
      const lastShot = shotHistory[0];
      const { halfLife } = medicationData[lastShot.medication];
      let hours = 0;
      let concentration = parseFloat(lastShot.dose);
      while (concentration > 0.01) {
        hours++;
        concentration = parseFloat(lastShot.dose) * Math.pow(0.5, hours / halfLife);
      }
      endDate = new Date(new Date(lastShot.dateTime).getTime() + hours * 3600000);
      break;
    }
  }

  const totalHours = Math.ceil((endDate - startDate) / 3600000);
  const labels = [];
  const timestamps = [];
  const concentrationData = new Array(totalHours + 1).fill(0);

  // Generate labels and timestamps for each hourly increment
  for (let hour = 0; hour <= totalHours; hour++) {
    const currentDate = new Date(startDate.getTime() + hour * 3600000);
    timestamps.push(currentDate);
    switch (graphView) {
      case "week":
        // For week view, display full weekday names at the start of each day
        labels.push(hour % 24 === 0 ? currentDate.toLocaleDateString("en-US", { weekday: "long" }) : "");
        break;
      case "month":
      case "90days":
        // For month and 90days, use our formatGraphLabel helper to display padded day/month per user setting
        labels.push(hour % 24 === 0 ? formatGraphLabel(currentDate) : "");
        break;
      case "alltime":
        // For alltime view, display the full date (including year) in the user's format
        labels.push(hour % 24 === 0 ? formatDate(currentDate) : "");
        break;
    }
  }

  // Calculate medication concentration for each shot over time
  for (const shot of shotHistory) {
    const { medication, dose, dateTime } = shot;
    const { halfLife, timeToPeak } = medicationData[medication];
    const shotTime = new Date(dateTime).getTime();

    for (let hour = 0; hour <= totalHours; hour++) {
      const currentTime = startDate.getTime() + hour * 3600000;
      const hoursSinceDose = (currentTime - shotTime) / 3600000;
      if (hoursSinceDose >= 0) {
        let concentration = 0;
        if (hoursSinceDose <= timeToPeak) {
          concentration = (hoursSinceDose / timeToPeak) * dose;
        } else {
          concentration = dose * Math.pow(0.5, (hoursSinceDose - timeToPeak) / halfLife);
        }
        concentrationData[hour] += concentration;
      }
    }
  }

  return { labels, values: concentrationData, timestamps };
}

/*******************************
 * Calculate Current Medication Level
 *******************************/
// New function that calculates the medication level at the current time
function calculateCurrentMedicationLevel(shotHistory) {
  const now = new Date();
  let level = 0;
  for (const shot of shotHistory) {
    const shotTime = new Date(shot.dateTime);
    const hoursSinceDose = (now - shotTime) / 3600000;
    if (hoursSinceDose < 0) continue; // future shots are ignored
    const dose = parseFloat(shot.dose);
    const med = medicationData[shot.medication];
    if (!med) continue;
    if (hoursSinceDose <= med.timeToPeak) {
      level += (hoursSinceDose / med.timeToPeak) * dose;
    } else {
      level += dose * Math.pow(0.5, (hoursSinceDose - med.timeToPeak) / med.halfLife);
    }
  }
  return level;
}

/*******************************
 * Update & Display Functions
 *******************************/

// Update most recent shot details and next shot estimation
function updateMostRecentShotDisplay() {
  const lastShotDate = document.getElementById("lastShotDate");
  const lastShotTime = document.getElementById("lastShotTime");
  const lastShotMedication = document.getElementById("lastShotMedication");
  const lastShotDose = document.getElementById("lastShotDose");
  const currentMedicationLevel = document.getElementById("currentMedicationLevel");
  const nextShotDate = document.getElementById("nextShotDate");
  const nextShotTime = document.getElementById("nextShotTime");
  const nextShotMedication = document.getElementById("nextShotMedication");
  const nextShotDose = document.getElementById("nextShotDose");

  // Sort shots by date (newest first)
  const sortedShots = [...shotHistory].sort((a, b) => new Date(b.dateTime) - new Date(a.dateTime));

  if (sortedShots.length > 0) {
    const mostRecent = sortedShots[0];
    const shotDate = new Date(mostRecent.dateTime);

    lastShotDate.textContent = formatDate(shotDate);
    lastShotTime.textContent = formatTime(shotDate);
    lastShotMedication.textContent = mostRecent.medication;
    lastShotDose.textContent = `${mostRecent.dose}mg`;

    // Calculate current medication level based on the user's current time and shot history
    const currentLevel = calculateCurrentMedicationLevel(shotHistory);
    currentMedicationLevel.textContent = `${mostRecent.medication}: ${currentLevel.toFixed(3)}mg`;

    // Estimated next shot: 7 days after the most recent shot
    const nextShot = new Date(shotDate);
    nextShot.setDate(shotDate.getDate() + 7);
    nextShotDate.textContent = formatDate(nextShot);
    nextShotTime.textContent = formatTime(nextShot);
    nextShotMedication.textContent = mostRecent.medication;
    nextShotDose.textContent = `${mostRecent.dose}mg`;
  } else {
    lastShotDate.textContent = "N/A";
    lastShotTime.textContent = "N/A";
    lastShotMedication.textContent = "N/A";
    lastShotDose.textContent = "N/A";
    currentMedicationLevel.textContent = "0mg";
    nextShotDate.textContent = "N/A";
    nextShotTime.textContent = "N/A";
    nextShotMedication.textContent = "N/A";
    nextShotDose.textContent = "N/A";
  }
}

// Get the last dose used for a given medication from shotHistory
function getLastDoseForMedication(medication) {
  const medicationShots = shotHistory
    .filter(shot => shot.medication === medication)
    .sort((a, b) => new Date(b.dateTime) - new Date(a.dateTime));
  return medicationShots[0]?.dose || null;
}

// Update the dose selection based on the last used dose for the selected medication
function updateDoseToLastUsed() {
  const selectedMedication = elements.medicationSelect.value;
  const lastDose = getLastDoseForMedication(selectedMedication);
  if (lastDose) {
    elements.doseSelect.value = lastDose;
  }
}

// Update display: refresh chart and shot details
function updateDisplay() {
  const data = calculateMedicationLevels(shotHistory, elements.graphViewSelect.value);
  createChart(data);
  updateMostRecentShotDisplay();
}

/*******************************
 * Event Handlers & Listeners
 *******************************/

// Save shot event handler
elements.saveShotButton.addEventListener("click", () => {
  const shotDate = datePicker.selectedDates[0];
  const shotTime = timePicker.selectedDates[0];
  const combinedDateTime = new Date(
    shotDate.getFullYear(),
    shotDate.getMonth(),
    shotDate.getDate(),
    shotTime.getHours(),
    shotTime.getMinutes()
  );

  const shotData = {
    dateTime: combinedDateTime.toISOString(),
    medication: elements.medicationSelect.value,
    dose: elements.doseSelect.value
  };

  shotHistory.unshift(shotData);
  localStorage.setItem("shotHistory", JSON.stringify(shotHistory));
  updateDisplay();

  setTimeout(updateDoseToLastUsed, 50);
});

// Update dose selection when medication changes
elements.medicationSelect.addEventListener("change", updateDoseToLastUsed);

// Change graph view handler
elements.graphViewSelect.addEventListener("change", updateDisplay);

// Render Shot History Modal
function renderShotHistory() {
  let modalContent = `
    <div class="modal-content">
      <h2>Shot History</h2>
      <table id="shotHistoryTable">
        <thead>
          <tr>
            <th>Date/Time</th>
            <th>Medication</th>
            <th>Dose</th>
            <th>Edit</th>
          </tr>
        </thead>
        <tbody>
          ${shotHistory.map((shot, index) => {
            const shotDate = new Date(shot.dateTime);
            const formattedDate = formatDate(shotDate);
            const formattedTime = formatTime(shotDate);
            return `<tr>
                      <td>${formattedDate} ${formattedTime}</td>
                      <td>${shot.medication}</td>
                      <td>${shot.dose}mg</td>
                      <td><button class="editShotButton" data-index="${index}">Edit</button></td>
                    </tr>`;
          }).join('')}
        </tbody>
      </table>
      <button id="closeModal">Close</button>
    </div>
  `;
  elements.modal.innerHTML = modalContent;
  elements.modal.style.display = "block";

  document.getElementById("closeModal").addEventListener("click", () => {
    elements.modal.style.display = "none";
  });

  document.querySelectorAll(".editShotButton").forEach(button => {
    button.addEventListener("click", (e) => {
      const index = e.target.getAttribute("data-index");
      editShot(index);
    });
  });
}

// Edit shot function to modify or delete a shot
function editShot(index) {
  const shot = shotHistory[index];
  const shotDate = new Date(shot.dateTime);
  const formattedDate = formatDate(shotDate);
  const formattedTime = formatTime(shotDate);
  
  const editContent = `
    <div class="modal-content">
      <h2>Edit Shot</h2>
      <label for="editMedication">Medication:</label>
      <select id="editMedication">
        <option value="mounjaro" ${shot.medication === "mounjaro" ? "selected" : ""}>Mounjaro</option>
      </select>
      <label for="editDose">Dose:</label>
      <select id="editDose">
        <option value="2.5" ${shot.dose === "2.5" ? "selected" : ""}>2.5mg</option>
        <option value="5" ${shot.dose === "5" ? "selected" : ""}>5mg</option>
        <option value="7.5" ${shot.dose === "7.5" ? "selected" : ""}>7.5mg</option>
        <option value="10" ${shot.dose === "10" ? "selected" : ""}>10mg</option>
        <option value="12.5" ${shot.dose === "12.5" ? "selected" : ""}>12.5mg</option>
        <option value="15" ${shot.dose === "15" ? "selected" : ""}>15mg</option>
      </select>
      <label for="editDate">Date:</label>
      <input type="text" id="editDate" value="${formattedDate}">
      <label for="editTime">Time:</label>
      <input type="text" id="editTime" value="${formattedTime}">
      <button id="saveEdit">Save Changes</button>
      <button id="deleteShot" class="btn-danger">Delete Shot</button>
      <button id="cancelEdit">Cancel</button>
    </div>
  `;
  
  elements.modal.innerHTML = editContent;
  elements.modal.style.display = "block";

  flatpickr(document.getElementById("editDate"), {
    dateFormat: flatpickrDateFormatMapping[userSettings.dateFormat],
    defaultDate: formattedDate
  });
  flatpickr(document.getElementById("editTime"), {
    enableTime: true,
    noCalendar: true,
    dateFormat: flatpickrTimeFormatMapping[userSettings.timeFormat],
    defaultDate: shotDate
  });

  document.getElementById("saveEdit").addEventListener("click", () => {
    const newMedication = document.getElementById("editMedication").value;
    const newDose = document.getElementById("editDose").value;
    const newDate = document.getElementById("editDate").value;
    const newTime = document.getElementById("editTime").value;
    
    let day, month, year;
    if (userSettings.dateFormat === "mm/dd/yyyy") {
      [month, day, year] = newDate.split("/");
    } else if (userSettings.dateFormat === "yyyy/mm/dd") {
      [year, month, day] = newDate.split("/");
    } else {
      [day, month, year] = newDate.split("/");
    }
    const dateTime = new Date(`${year}-${month}-${day} ${newTime}`);
    
    shotHistory[index] = {
      dateTime: dateTime.toISOString(),
      medication: newMedication,
      dose: newDose
    };
    localStorage.setItem("shotHistory", JSON.stringify(shotHistory));
    updateDisplay();
    renderShotHistory();
  });

  document.getElementById("deleteShot").addEventListener("click", () => {
    if (confirm("Are you sure you want to delete this shot?")) {
      shotHistory.splice(index, 1);
      localStorage.setItem("shotHistory", JSON.stringify(shotHistory));
      updateDisplay();
      renderShotHistory();
    }
  });

  document.getElementById("cancelEdit").addEventListener("click", () => {
    renderShotHistory();
  });
}

// Shot History button event listener
elements.shotHistoryButton.addEventListener("click", () => {
  renderShotHistory();
});

/**********************
 * Initialization
 **********************/
document.addEventListener("DOMContentLoaded", () => {
  elements.modal.style.display = "none"; // Ensure shot history modal is hidden
  updateDisplay();
  updateMostRecentShotDisplay();
  updateDoseToLastUsed();

  // Settings modal: open on settings button click
  document.getElementById("settingsButton").addEventListener("click", () => {
    const settingsModal = document.getElementById("settingsModal");
    settingsModal.style.display = "block";

    // Pre-select current settings
    document.getElementById("timeFormat").value = userSettings.timeFormat;
    document.getElementById("dateFormat").value = userSettings.dateFormat;
    document.getElementById("weekStart").value = userSettings.weekStart;
  });

  // Settings modal: close when clicking the close button
  document.querySelector("#settingsModal .close-modal").addEventListener("click", () => {
    document.getElementById("settingsModal").style.display = "none";
  });

  // **SYNC MODAL - OPEN**
  document.getElementById("Syncing").addEventListener("click", () => {
    document.getElementById("syncModal").style.display = "block"; // Open sync modal
  });

  // **SYNC MODAL - CLOSE**
  document.querySelector("#syncModal .close-modal").addEventListener("click", () => {
    document.getElementById("syncModal").style.display = "none"; // Close sync modal
  });

  // **SYNC MODAL - EXPORT DATA**
  document.getElementById("exportData").addEventListener("click", () => {
    const exportData = {
      shotHistory: JSON.parse(localStorage.getItem("shotHistory") || "[]"),
      settings: {
        dateFormat: localStorage.getItem("dateFormat"),
        timeFormat: localStorage.getItem("timeFormat"),
        weekStart: localStorage.getItem("weekStart")
      }
    };

    const blob = new Blob([JSON.stringify(exportData)], {type: "application/json"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `med-tracker-backup-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  // **SYNC MODAL - IMPORT DATA**
  document.getElementById("importData").addEventListener("change", function(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const importedData = JSON.parse(event.target.result);

        // Validate structure
        if (!importedData.shotHistory || !importedData.settings) {
          throw new Error("Invalid data format");
        }

        // Save data to localStorage
        localStorage.setItem("shotHistory", JSON.stringify(importedData.shotHistory));
        localStorage.setItem("dateFormat", importedData.settings.dateFormat);
        localStorage.setItem("timeFormat", importedData.settings.timeFormat);
        localStorage.setItem("weekStart", importedData.settings.weekStart);

        // Update UI
        shotHistory = importedData.shotHistory;
        userSettings = importedData.settings;
        updateFlatpickrFormats();
        updateDisplay();

        showSyncStatus("Data imported successfully!", "success");
        setTimeout(() => window.location.reload(), 1000); // Reload page after successful import
      } catch (error) {
        showSyncStatus(`Import failed: ${error.message}`, "error");
      }
    };
    reader.readAsText(file);
  });
});

function showSyncStatus(message, type) {
  const statusDiv = document.getElementById("syncStatus");
  statusDiv.textContent = message;
  statusDiv.className = type;
  setTimeout(() => {
    statusDiv.textContent = "";
    statusDiv.className = "";
  }, 5000);
}