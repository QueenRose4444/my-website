// meds.js - Handles medication and weight tracking, login, data sync (local & backend) with Multi-Session Refresh Tokens

/*************************************
 * APPLICATION & ENVIRONMENT CONFIGURATION
 *************************************/
// -- SET YOUR APPLICATION NAME HERE --
// This MUST be unique for each application to keep data separate.
const APP_NAME = 'med-tracker'; // This identifies the data "bucket" on the server.

// SET THE ENVIRONMENT HERE: 'live' or 'wip'
const ENVIRONMENT = 'live'; // 'live' or 'wip'

// --- Configuration settings for each environment ---
const envConfigs = {
    live: {
        storagePrefix: `${APP_NAME}_live_`,
        backendUrl: 'https://meds-login_api.rosestuffs.org'
    },
    wip: {
        storagePrefix: `${APP_NAME}_wip_`,
        backendUrl: 'https://meds-login_api-wip.rosestuffs.org'
    }
};

// --- Active configuration based on the environment set above ---
const activeConfig = envConfigs[ENVIRONMENT];


/*************************************
 * LOGGING CONFIGURATION
 *************************************/
const LOGGING_ENABLED = ENVIRONMENT === 'wip';

function syncLog(...args) {
    if (LOGGING_ENABLED) {
        console.log('[SYNC_LOG]', ...args);
    }
}


/*************************************
 * CONSTANTS
 *************************************/
const storagePrefix = activeConfig.storagePrefix;
const BACKEND_URL = activeConfig.backendUrl;
const LOGIN_ENDPOINT = `${BACKEND_URL}/api/auth/login`;
const REGISTER_ENDPOINT = `${BACKEND_URL}/api/auth/register`;
const REFRESH_ENDPOINT = `${BACKEND_URL}/api/auth/refresh`;
const LOGOUT_ENDPOINT = `${BACKEND_URL}/api/auth/logout`;
// UPDATED: This now points to the new, dynamic data endpoint.
const USER_DATA_ENDPOINT = `${BACKEND_URL}/api/data/${APP_NAME}`;
const CHANGE_PASSWORD_ENDPOINT = `${BACKEND_URL}/api/auth/change-password`;

// Unit Conversion Constants
const POUNDS_PER_KG = 2.20462;
const POUNDS_PER_STONE = 14;
const INCHES_PER_CM = 0.393701;
const INCHES_PER_FOOT = 12;


/*************************************
 * Global State & Settings
 *************************************/
let shotHistory = [];
let weightHistory = [];
let userSettings = {};
let tempSettings = {};
let currentUser = null;
let authToken = localStorage.getItem(`${storagePrefix}authToken`);
let refreshToken = localStorage.getItem(`${storagePrefix}refreshToken`);
let isRefreshingToken = false;
let refreshSubscribers = [];

const defaultSettings = {
    dateFormat: "dd/mm/yyyy",
    timeFormat: "12hr",
    weekStart: "Sunday",
    medGraphView: 'month',
    weightUnit: "kg",
    heightUnit: "cm",
    goalWeight: null,
    userHeight: null,
    showBmi: false,
    weightGraphView: 'month'
};

const flatpickrDateFormatMapping = {
    "dd/mm/yyyy": "d/m/Y",
    "mm/dd/yyyy": "m/d/Y",
    "yyyy/mm/dd": "Y/m/d"
};
const flatpickrTimeFormatMapping = {
    "12hr": "h:i K",
    "24hr": "H:i"
};

const medicationData = {
    mounjaro: { halfLife: 120, timeToPeak: 48 },
};

/***********************
 * DOM Element References
 ***********************/
function getElements() {
    const elements = {
        viewModeCombinedBtn: document.getElementById('viewModeCombined'),
        viewModeMedsBtn: document.getElementById('viewModeMeds'),
        viewModeWeightBtn: document.getElementById('viewModeWeight'),
        medTrackerSection: document.getElementById('medTrackerSection'),
        weightTrackerSection: document.getElementById('weightTrackerSection'),
        medicationSelect: document.getElementById("medication"),
        doseSelect: document.getElementById("dose"),
        dateInput: document.getElementById("date"),
        timeInput: document.getElementById("time"),
        saveShotButton: document.getElementById("saveShot"),
        shotHistoryButton: document.getElementById("shotHistory"),
        medChartCanvas: document.getElementById("medicationChart"),
        graphViewSelect: document.getElementById("graphViewSelect"),
        lastShotDate: document.getElementById("lastShotDate"),
        lastShotTime: document.getElementById("lastShotTime"),
        lastShotMedication: document.getElementById("lastShotMedication"),
        lastShotDose: document.getElementById("lastShotDose"),
        currentMedicationLevel: document.getElementById("currentMedicationLevel"),
        nextShotDate: document.getElementById("nextShotDate"),
        nextShotTime: document.getElementById("nextShotTime"),
        nextShotMedication: document.getElementById("nextShotMedication"),
        nextShotDose: document.getElementById("nextShotDose"),
        shotHistoryModal: document.getElementById("shotHistoryModal"),
        penDosesRemaining: document.getElementById("penDosesRemaining"),
        penEmptyDate: document.getElementById("penEmptyDate"),
        weightDateInput: document.getElementById('weightDate'),
        weightTimeInput: document.getElementById('weightTime'),
        weightValueInput: document.getElementById('weightValue'),
        weightEntryUnit: document.getElementById('weightEntryUnit'),
        saveWeightEntryButton: document.getElementById('saveWeightEntry'),
        weightHistoryButton: document.getElementById('weightHistoryButton'),
        weightGraphViewSelect: document.getElementById('weightGraphViewSelect'),
        weightChartCanvas: document.getElementById('weightChart'),
        weightHistoryModal: document.getElementById('weightHistoryModal'),
        startWeightStat: document.getElementById('startWeightStat'),
        goalWeightStat: document.getElementById('goalWeightStat'),
        toGoWeightStat: document.getElementById('toGoWeightStat'),
        currentWeightStat: document.getElementById('currentWeightStat'),
        currentBmiLine: document.getElementById('currentBmiLine'),
        currentBmiStat: document.getElementById('currentBmiStat'),
        totalLostWeightStat: document.getElementById('totalLostWeightStat'),
        lostThisWeekStat: document.getElementById('lostThisWeekStat'),
        avgWeeklyLossStat: document.getElementById('avgWeeklyLossStat'),
        weightEntrySingleContainer: document.getElementById('weightEntrySingleContainer'),
        weightEntryStonePoundsContainer: document.getElementById('weightEntryStonePoundsContainer'),
        weightEntryStone: document.getElementById('weightEntryStone'),
        weightEntryPounds: document.getElementById('weightEntryPounds'),
        settingsButton: document.getElementById("settingsButton"),
        localSyncButton: document.getElementById("localSyncButton"),
        settingsModal: document.getElementById("settingsModal"),
        loginModal: document.getElementById("loginModal"),
        registerModal: document.getElementById("registerModal"),
        changePasswordModal: document.getElementById("changePasswordModal"),
        syncModal: document.getElementById("syncModal"),
        syncChoiceModal: document.getElementById("syncChoiceModal"),
        loginButton: document.getElementById("loginButton"),
        registerButton: document.getElementById("registerButton"),
        logoutButton: document.getElementById("logoutButton"),
        userStatus: document.getElementById("userStatus"),
        loginForm: document.getElementById("loginForm"),
        registerForm: document.getElementById("registerForm"),
        loginUsernameInput: document.getElementById("loginUsername"),
        loginPasswordInput: document.getElementById("loginPassword"),
        loginError: document.getElementById("loginError"),
        registerUsernameInput: document.getElementById("registerUsername"),
        registerPasswordInput: document.getElementById("registerPassword"),
        registerConfirmPasswordInput: document.getElementById("registerConfirmPassword"),
        registerError: document.getElementById("registerError"),
        timeFormatSelect: document.getElementById("timeFormat"),
        dateFormatSelect: document.getElementById("dateFormat"),
        weekStartSelect: document.getElementById("weekStart"),
        saveSettingsButton: document.getElementById("saveSettings"),
        changePasswordButton: document.getElementById("changePasswordButton"),
        weightUnitSelect: document.getElementById('weightUnit'),
        goalWeightInput: document.getElementById('goalWeight'),
        goalWeightUnitLabel: document.getElementById('goalWeightUnitLabel'),
        goalWeightSingleContainer: document.getElementById('goalWeightSingleContainer'),
        goalWeightStonePoundsContainer: document.getElementById('goalWeightStonePoundsContainer'),
        goalWeightStone: document.getElementById('goalWeightStone'),
        goalWeightPounds: document.getElementById('goalWeightPounds'),
        userHeightInput: document.getElementById('userHeight'),
        heightUnitLabel: document.getElementById('heightUnitLabel'),
        heightUnitSelect: document.getElementById('heightUnit'),
        userHeightSingleContainer: document.getElementById('userHeightSingleContainer'),
        userHeightFeetInchesContainer: document.getElementById('userHeightFeetInchesContainer'),
        userHeightFeet: document.getElementById('userHeightFeet'),
        userHeightInches: document.getElementById('userHeightInches'),
        showBmiToggle: document.getElementById('showBmiToggle'),
        changePasswordForm: document.getElementById("changePasswordForm"),
        currentPasswordInput: document.getElementById("currentPassword"),
        newPasswordInput: document.getElementById("newPassword"),
        confirmNewPasswordInput: document.getElementById("confirmNewPassword"),
        changePasswordError: document.getElementById("changePasswordError"),
        changePasswordSuccess: document.getElementById("changePasswordSuccess"),
        exportDataButton: document.getElementById("exportData"),
        importDataInput: document.getElementById("importData"),
        syncStatus: document.getElementById("syncStatus"),
    };
    return elements;
}

/************************************
 * Unit Conversion Helpers
 ************************************/
const kgToLbs = kg => kg * POUNDS_PER_KG;
const lbsToKg = lbs => lbs / POUNDS_PER_KG;

function kgToStonePounds(kg) {
    if (kg === null || isNaN(kg)) return { stone: '', pounds: '' };
    const totalPounds = kg * POUNDS_PER_KG;
    const stone = Math.floor(totalPounds / POUNDS_PER_STONE);
    const pounds = totalPounds % POUNDS_PER_STONE;
    return { stone, pounds };
}

function stonePoundsToKg(stone, pounds) {
    const s = parseFloat(stone) || 0;
    const p = parseFloat(pounds) || 0;
    const totalPounds = (s * POUNDS_PER_STONE) + p;
    return totalPounds / POUNDS_PER_KG;
}

function cmToFeetInches(cm) {
    if (cm === null || isNaN(cm)) return { feet: '', inches: '' };
    const totalInches = cm * INCHES_PER_CM;
    const feet = Math.floor(totalInches / INCHES_PER_FOOT);
    const inches = totalInches % INCHES_PER_FOOT;
    return { feet, inches };
}

function feetInchesToCm(feet, inches) {
    const ft = parseFloat(feet) || 0;
    const inch = parseFloat(inches) || 0;
    const totalInches = (ft * INCHES_PER_FOOT) + inch;
    return totalInches / INCHES_PER_CM;
}

/************************************
 * Data Loading / Saving Logic
 ************************************/
function loadLocalData() {
    syncLog("Loading all data from localStorage...");
    try {
        const storedShotHistory = JSON.parse(localStorage.getItem(`${storagePrefix}shotHistory`) || "[]");
        shotHistory = storedShotHistory
            .map(shot => ({ ...shot, dateTime: new Date(shot.dateTime) }))
            .filter(shot => shot.dateTime && !isNaN(shot.dateTime));

        const storedWeightHistory = JSON.parse(localStorage.getItem(`${storagePrefix}weightHistory`) || "[]");
        weightHistory = storedWeightHistory
            .map(entry => ({ ...entry, dateTime: new Date(entry.dateTime), weightKg: parseFloat(entry.weightKg) }))
            .filter(entry => entry.dateTime && !isNaN(entry.dateTime) && !isNaN(entry.weightKg));

        const storedSettings = JSON.parse(localStorage.getItem(`${storagePrefix}userSettings`) || "{}");
        userSettings = { ...defaultSettings, ...storedSettings };

    } catch (e) {
        console.error("Error loading local data:", e);
        shotHistory = [];
        weightHistory = [];
        userSettings = { ...defaultSettings };
    }
}

function saveLocalData() {
    syncLog("Saving all data to localStorage...");
    try {
        localStorage.setItem(`${storagePrefix}shotHistory`, JSON.stringify(shotHistory));
        localStorage.setItem(`${storagePrefix}weightHistory`, JSON.stringify(weightHistory));
        localStorage.setItem(`${storagePrefix}userSettings`, JSON.stringify(userSettings));
    } catch (e) {
        console.error("Error saving local data:", e);
    }
}


/************************************
 * Auth & Backend Data Logic
 ************************************/
function decodeJwtPayload(token) {
    try {
        const base64Url = token.split('.')[1];
        if (!base64Url) throw new Error("Invalid JWT structure");
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = decodeURIComponent(atob(base64).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
        return JSON.parse(jsonPayload);
    } catch (e) {
        console.error("Failed to decode JWT:", e);
        return null;
    }
}

function isTokenExpired(token) {
    if (!token) return true;
    try {
        const payload = decodeJwtPayload(token);
        const expiresAt = payload.exp * 1000;
        return Date.now() >= (expiresAt - 10000);
    } catch (e) {
        return true;
    }
}

async function attemptRefreshToken() {
    if (!refreshToken) return false;
    if (isRefreshingToken) {
        return new Promise(resolve => refreshSubscribers.push(resolve));
    }
    isRefreshingToken = true;
    let success = false;
    try {
        const response = await fetch(REFRESH_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Refresh failed');
        authToken = data.accessToken;
        localStorage.setItem(`${storagePrefix}authToken`, authToken);
        currentUser = decodeJwtPayload(authToken);
        success = true;
    } catch (error) {
        await logoutUser("Your session has expired. Please log in again.");
        success = false;
    } finally {
        isRefreshingToken = false;
        refreshSubscribers.forEach(cb => cb(success));
        refreshSubscribers = [];
        return success;
    }
}

async function fetchWithAuth(url, options = {}) {
    if (!authToken || isTokenExpired(authToken)) {
        const refreshed = await attemptRefreshToken();
        if (!refreshed) throw new Error("Authentication failed; session expired.");
    }

    options.headers = { ...options.headers, 'Authorization': `Bearer ${authToken}`, 'Content-Type': 'application/json' };
    let response = await fetch(url, options);

    if (response.status === 401) {
        const refreshed = await attemptRefreshToken();
        if (refreshed) {
            options.headers['Authorization'] = `Bearer ${authToken}`;
            response = await fetch(url, options);
        } else {
             throw new Error("Authentication failed after retry.");
        }
    }
    return response;
}

async function fetchBackendData() {
    if (!authToken && !refreshToken) return null;
    try {
        const response = await fetchWithAuth(USER_DATA_ENDPOINT, { method: 'GET' });
        if (!response.ok) throw new Error((await response.json()).error || 'Failed to fetch');
        const data = await response.json();

        data.shotHistory = (data.shotHistory || []).map(s => ({ ...s, dateTime: new Date(s.dateTime) })).filter(s => !isNaN(s.dateTime));
        data.weightHistory = (data.weightHistory || []).map(e => ({ ...e, dateTime: new Date(e.dateTime), weightKg: parseFloat(e.weightKg) })).filter(e => !isNaN(e.dateTime) && e.weightKg != null);
        data.settings = { ...defaultSettings, ...(data.settings || {}) };
        
        return data;
    } catch (error) {
        console.error("Failed to fetch backend data:", error);
        return null;
    }
}

async function saveBackendData() {
    if (!currentUser || !authToken) return false;
    
    const dataToSave = {
        shotHistory: shotHistory,
        weightHistory: weightHistory,
        settings: userSettings
    };
    syncLog("Saving data to backend:", dataToSave);
    try {
        const response = await fetchWithAuth(USER_DATA_ENDPOINT, {
            method: 'POST',
            body: JSON.stringify(dataToSave)
        });
        if (!response.ok) throw new Error((await response.json()).error || 'Failed to save');
        syncLog("Backend save successful.");
        return true;
    } catch (error) {
        console.error("Failed to save backend data:", error);
        alert(`Failed to save data to server: ${error.message}`);
        return false;
    }
}

function saveData() {
    saveLocalData();
    if (currentUser && authToken) {
        saveBackendData();
    }
    updateDisplay();
}

/************************************
 * Date/Time/Chart/Calculation Logic
 ************************************/
let medicationChart, weightChart;
let datePicker, timePicker, weightDatePicker, weightTimePicker;

function formatDate(date) {
    if (!(date instanceof Date) || isNaN(date)) return "N/A";
    const d = String(date.getDate()).padStart(2, "0");
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const y = date.getFullYear();
    switch (userSettings.dateFormat) {
        case "mm/dd/yyyy": return `${m}/${d}/${y}`;
        case "yyyy/mm/dd": return `${y}/${m}/${d}`;
        default: return `${d}/${m}/${y}`;
    }
}

function formatGraphLabel(date) {
    if (!(date instanceof Date) || isNaN(date)) return "";
    const d = String(date.getDate()).padStart(2, "0");
    const m = String(date.getMonth() + 1).padStart(2, "0");
    return userSettings.dateFormat === "mm/dd/yyyy" ? `${m}/${d}` : `${d}/${m}`;
}

function formatDayOfWeek(date) {
    if (!(date instanceof Date) || isNaN(date)) return "";
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return days[date.getDay()];
}

function formatTime(date) {
    if (!(date instanceof Date) || isNaN(date)) return "N/A";
    return date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: userSettings.timeFormat === "12hr" });
}

function initializeFlatpickr() {
    const elements = getElements();
    const fpDateFormat = flatpickrDateFormatMapping[userSettings.dateFormat] || "d/m/Y";
    const fpTimeFormat = flatpickrTimeFormatMapping[userSettings.timeFormat] || "h:i K";
    
    if (datePicker) datePicker.destroy();
    if (timePicker) timePicker.destroy();
    datePicker = flatpickr(elements.dateInput, { dateFormat: fpDateFormat, defaultDate: "today", altInput: true, altFormat: fpDateFormat, allowInput: true });
    timePicker = flatpickr(elements.timeInput, { enableTime: true, noCalendar: true, dateFormat: fpTimeFormat, defaultDate: new Date(), time_24hr: userSettings.timeFormat === "24hr", altInput: true, altFormat: fpTimeFormat, allowInput: true });
    
    if (weightDatePicker) weightDatePicker.destroy();
    if (weightTimePicker) weightTimePicker.destroy();
    weightDatePicker = flatpickr(elements.weightDateInput, { dateFormat: fpDateFormat, defaultDate: "today", altInput: true, altFormat: fpDateFormat, allowInput: true });
    weightTimePicker = flatpickr(elements.weightTimeInput, { enableTime: true, noCalendar: true, dateFormat: fpTimeFormat, defaultDate: new Date(), time_24hr: userSettings.timeFormat === "24hr", altInput: true, altFormat: fpTimeFormat, allowInput: true });
}

function createChart(data) {
    const elements = getElements();
    if (!elements.medChartCanvas) { return; }
    const ctx = elements.medChartCanvas.getContext('2d');
    if (!ctx) { return; }
    const chartData = (data && data.labels && data.values && data.timestamps && data.labels.length > 0)
        ? data
        : { labels: ["No Data"], values: [0], timestamps: [new Date()] };
    if (medicationChart) {
        medicationChart.destroy();
    }
    try {
        medicationChart = new Chart(ctx, {
            type: "line",
            data: {
                labels: chartData.labels,
                datasets: [{
                    label: "Medication Level",
                    data: chartData.values,
                    borderColor: "#4bc0c0",
                    backgroundColor: 'rgba(75, 192, 192, 0.2)',
                    fill: true, 
                    tension: 0.3, 
                    pointRadius: 1.5, // Reverted to original visual size
                    pointHoverRadius: 5, // Reverted to original visual size
                    pointHitRadius: 15 // Kept large for easy tapping
                }],
                timestamps: chartData.timestamps
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: {
                    tooltip: {
                        callbacks: {
                            title: function(context) {
                                try {
                                    if (!context || context.length === 0 || !context[0]) return "No data point";
                                    const index = context[0].dataIndex;
                                    if (!medicationChart || !medicationChart.data || !medicationChart.data.timestamps) return "Chart Error";
                                    const timestamps = medicationChart.data.timestamps;
                                    if (index < 0 || index >= timestamps.length) return "Invalid Index";
                                    const ts = timestamps[index];
                                    if (!(ts instanceof Date) || isNaN(ts)) return "Invalid Date";
                                    return `${formatDate(ts)} ${formatTime(ts)}`;
                                } catch (e) {
                                     console.error("Error in tooltip title callback:", e, { context });
                                     return "Error";
                                }
                            },
                            label: function(context) {
                                try {
                                    let value = context.parsed.y;
                                    return `Level: ${value.toFixed(3)}mg`;
                                } catch (e) { return "Error"; }
                            }
                        }
                    },
                    legend: { display: false }
                },
                scales: {
                    x: {
                        ticks: {
                            callback: (value, index, ticks) => {
                                try {
                                    const view = elements.graphViewSelect?.value || 'month';
                                    const timestamps = chartData.timestamps;
                                    if (!timestamps || timestamps.length <= index) return "";
                                    const currentTimestamp = timestamps[index];
                                    if (!(currentTimestamp instanceof Date) || isNaN(currentTimestamp)) return "";

                                    if (view === 'week' || view === '14days') {
                                        if (currentTimestamp.getHours() === 0 || index === 0) {
                                            return `${formatDayOfWeek(currentTimestamp)} ${currentTimestamp.getDate()}`;
                                        }
                                        return "";
                                    }

                                    if (currentTimestamp.getHours() !== 0 && index !== 0) return "";

                                    const totalDays = Math.ceil((timestamps[timestamps.length - 1] - timestamps[0]) / (1000 * 60 * 60 * 24));
                                    switch (view) {
                                        case "month":
                                            return index % (2 * 24) === 0 ? formatGraphLabel(currentTimestamp) : "";
                                        case "90days":
                                            return index % (5 * 24) === 0 ? formatGraphLabel(currentTimestamp) : "";
                                        case "alltime":
                                            if (totalDays <= 14) return formatGraphLabel(currentTimestamp);
                                            if (totalDays <= 30) return index % (2 * 24) === 0 ? formatGraphLabel(currentTimestamp) : "";
                                            if (totalDays <= 90) return index % (7 * 24) === 0 ? formatGraphLabel(currentTimestamp) : "";
                                            if (totalDays <= 365) return index % (14 * 24) === 0 ? formatGraphLabel(currentTimestamp) : "";
                                            return index % (30 * 24) === 0 ? formatGraphLabel(currentTimestamp) : "";
                                        default:
                                            return formatGraphLabel(currentTimestamp);
                                    }
                                } catch (e) { return ""; }
                            },
                            autoSkip: false, maxRotation: 0,
                        }
                    },
                    y: {
                        beginAtZero: true,
                        ticks: { callback: value => `${value.toFixed(2)}mg` }
                    }
                }
            }
        });
    } catch (chartError) {
        console.error("Failed to create chart:", chartError);
    }
}

function createWeightChart(data) {
    const elements = getElements();
    if (!elements.weightChartCanvas) return;
    const ctx = elements.weightChartCanvas.getContext('2d');
    if (weightChart) weightChart.destroy();
    
    const unit = userSettings.weightUnit || 'kg';
    let unitLabel = unit;
    if(unit === 'st-lbs') unitLabel = 'st';
    
    const goalWeightKg = userSettings.goalWeight;
    let goalWeightDisplay = null;
    if (goalWeightKg !== null) {
        if (unit === 'kg') goalWeightDisplay = goalWeightKg;
        else if (unit === 'lbs') goalWeightDisplay = kgToLbs(goalWeightKg);
        else if (unit === 'st-lbs') {
            const { stone, pounds } = kgToStonePounds(goalWeightKg);
            goalWeightDisplay = stone + pounds / POUNDS_PER_STONE;
        }
    }

    const datasets = [{ 
        label: `Weight`, 
        data: data.values, 
        borderColor: "#a29bfe", 
        backgroundColor: 'rgba(162, 155, 254, 0.2)', 
        fill: true, 
        tension: 0.1, 
        pointRadius: 3, // Reverted to original visual size
        pointHoverRadius: 6, // Reverted to original visual size
        pointHitRadius: 15, // Kept large for easy tapping
        pointBackgroundColor: '#a29bfe',
        segment: {
            borderColor: ctx => ctx.p1.raw.isEstimate ? 'rgba(162, 155, 254, 0.5)' : undefined,
            borderDash: ctx => ctx.p1.raw.isEstimate ? [6, 6] : undefined,
        }
    }];

    if (goalWeightDisplay !== null && data.labels.length > 0) {
        datasets.push({ 
            label: `Goal`, 
            data: data.labels.map(() => goalWeightDisplay), 
            borderColor: '#fd79a8', 
            borderDash: [5, 5], 
            fill: false, 
            pointRadius: 0, 
            borderWidth: 2 
        });
    }

    const view = elements.weightGraphViewSelect.value;

    weightChart = new Chart(ctx, {
        type: 'line',
        data: { labels: data.labels, datasets, timestamps: data.timestamps },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                tooltip: { 
                    callbacks: {
                        title: ctx => formatDate(new Date(weightChart.data.timestamps[ctx[0].dataIndex])),
                        label: function(context) {
                            const dataIndex = context.dataIndex;
                            const dataset = context.chart.data.datasets[0].data;
                            const currentPoint = dataset[dataIndex];
                            const currentValue = currentPoint.y;

                            let currentKgValue;
                            if (unit === 'kg') currentKgValue = currentValue;
                            else if (unit === 'lbs') currentKgValue = lbsToKg(currentValue);
                            else {
                                const stone = Math.floor(currentValue);
                                const pounds = (currentValue - stone) * POUNDS_PER_STONE;
                                currentKgValue = stonePoundsToKg(stone, pounds);
                            }
                            const weightString = `Weight: ${formatWeightDisplay(currentKgValue, unit, { showUnit: true })}`;

                            if (currentPoint.isEstimate) {
                                return weightString;
                            }

                            if (dataIndex > 0) {
                                const previousPoint = dataset[dataIndex - 1];
                                if (previousPoint.isEstimate) {
                                    return weightString;
                                }
                                
                                const previousValue = previousPoint.y;
                                const diff = currentValue - previousValue;

                                let diffKgValue;
                                if (unit === 'kg') diffKgValue = diff;
                                else if (unit === 'lbs') diffKgValue = lbsToKg(diff);
                                else {
                                    const totalPoundsDiff = diff * POUNDS_PER_STONE;
                                    diffKgValue = lbsToKg(totalPoundsDiff);
                                }
                                
                                if (Math.abs(diffKgValue).toFixed(2) === '0.00') {
                                    return weightString;
                                }

                                const changeString = `Change: ${diffKgValue > 0 ? '+' : ''}${formatWeightDisplay(diffKgValue, unit, { showUnit: true })}`;
                                
                                return [weightString, changeString];
                            }

                            return weightString;
                        }
                    }
                },
                legend: { display: datasets.length > 1, labels: { color: '#bbb' } }
            },
            scales: {
                x: {
                    type: 'time',
                    time: {
                        tooltipFormat: 'PP',
                        unit: view === 'year' || (view === 'alltime' && data.labels.length > 365 * 2) ? 'month' : 'day',
                        displayFormats: {
                           'day': view === 'week' || view === '14days' ? 'EEE d' : 'MMM d', 
                           'month': 'MMM yyyy'
                        }
                    },
                    ticks: { color: '#bbb' },
                    grid: { color: 'rgba(255,255,255,0.1)' }
                },
                y: { 
                    min: data.scaleMin,
                    max: data.scaleMax,
                    ticks: { 
                        callback: v => `${v.toFixed(1)} ${unitLabel}`, 
                        color: '#bbb' 
                    }, 
                    grid: { color: 'rgba(255,255,255,0.1)' } 
                }
            }
        }
    });
}

function calculateMedicationLevels(history, graphView) {
    if (!Array.isArray(history)) history = [];
    const validHistory = history
        .map(shot => ({ ...shot, dateTime: shot.dateTime instanceof Date ? shot.dateTime : new Date(shot.dateTime), dose: String(shot.dose) }))
        .filter(shot => shot && shot.dateTime && !isNaN(shot.dateTime) && shot.medication && shot.dose);
    if (validHistory.length === 0) return { labels: [], values: [], timestamps: [] };
    const now = new Date();
    let startDate, endDate;
    validHistory.sort((a, b) => a.dateTime - b.dateTime);
    const firstShotDate = validHistory[0].dateTime;
    const lastShotDate = validHistory[validHistory.length - 1].dateTime;
    switch (graphView) {
        case "week": {
            const weekDays = { "Sunday": 0, "Monday": 1, "Tuesday": 2, "Wednesday": 3, "Thursday": 4, "Friday": 5, "Saturday": 6 };
            const desiredStartDay = weekDays[userSettings.weekStart] || 0;
            startDate = new Date(now);
            let currentDay = startDate.getDay();
            let diff = (currentDay - desiredStartDay + 7) % 7;
            startDate.setDate(startDate.getDate() - diff);
            startDate.setHours(0, 0, 0, 0);
            endDate = new Date(startDate);
            endDate.setDate(startDate.getDate() + 7);
            endDate.setMilliseconds(endDate.getMilliseconds() - 1);
            break;
        }
        case "14days": {
            startDate = new Date(now);
            startDate.setDate(now.getDate() - 7);
            startDate.setHours(0, 0, 0, 0);
            endDate = new Date(now);
            endDate.setDate(now.getDate() + 7);
            endDate.setHours(23, 59, 59, 999);
            break;
        }
        case "month":
            startDate = new Date(now.getFullYear(), now.getMonth(), 1);
            endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
            break;
        case "90days":
             startDate = new Date(now);
             startDate.setDate(now.getDate() - 30);
             startDate.setHours(0, 0, 0, 0);
             endDate = new Date(now);
             endDate.setDate(now.getDate() + 60);
             endDate.setHours(23, 59, 59, 999);
             break;
        case "alltime": {
             startDate = new Date(firstShotDate);
             startDate.setHours(0, 0, 0, 0);
             let estimatedEndDate = new Date(lastShotDate);
             const lastShot = validHistory[validHistory.length - 1];
             const medInfo = medicationData[lastShot.medication];
             if (medInfo && medInfo.halfLife) {
                 const dose = parseFloat(lastShot.dose);
                 const threshold = 0.01;
                 if (dose > threshold) {
                     const hoursToDecay = medInfo.halfLife * Math.log2(dose / threshold);
                     estimatedEndDate = new Date(lastShotDate.getTime() + (hoursToDecay + (medInfo.timeToPeak || 0)) * 3600000);
                 } else {
                     estimatedEndDate.setDate(estimatedEndDate.getDate() + 7);
                 }
             } else {
                 estimatedEndDate.setDate(estimatedEndDate.getDate() + 30);
             }
             let futureEndDate = new Date(now);
             futureEndDate.setDate(now.getDate() + 30);
             endDate = estimatedEndDate > futureEndDate ? estimatedEndDate : futureEndDate;
             endDate.setHours(23, 59, 59, 999);
             break;
        }
        default:
            startDate = new Date(now.getFullYear(), now.getMonth(), 1);
            endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    }
    if (isNaN(startDate) || isNaN(endDate) || startDate >= endDate) return { labels: [], values: [], timestamps: [] };
    const totalHours = Math.ceil((endDate.getTime() - startDate.getTime()) / 3600000);
    if (totalHours <= 0 || totalHours > 24 * 365 * 20) return { labels: [], values: [], timestamps: [] };
    const labels = [];
    const timestamps = [];
    const concentrationData = new Array(totalHours + 1).fill(0);
    for (let hour = 0; hour <= totalHours; hour++) {
        const currentDate = new Date(startDate.getTime() + hour * 3600000);
        timestamps.push(currentDate);
        labels.push("");
    }
    for (const shot of validHistory) {
        const { medication, dose, dateTime } = shot;
        const medInfo = medicationData[medication];
        if (!medInfo || !medInfo.halfLife) continue;
        const { halfLife, timeToPeak = 0 } = medInfo;
        const shotTime = dateTime.getTime();
        const floatDose = parseFloat(dose);
        if (isNaN(floatDose) || floatDose <= 0) continue;
        for (let hour = 0; hour <= totalHours; hour++) {
            const currentTime = timestamps[hour].getTime();
            const hoursSinceDose = (currentTime - shotTime) / 3600000;
            if (hoursSinceDose >= 0) {
                let concentration = 0;
                if (hoursSinceDose <= timeToPeak) {
                    concentration = (timeToPeak > 0) ? (hoursSinceDose / timeToPeak) * floatDose : floatDose;
                }
                else {
                    concentration = floatDose * Math.pow(0.5, (hoursSinceDose - timeToPeak) / halfLife);
                }
                if (!isNaN(concentration) && concentration > 0) {
                    concentrationData[hour] += concentration;
                }
            }
        }
    }
    return { labels, values: concentrationData, timestamps };
}

/**
 * [FIXED] Calculates weight chart data, handling large gaps by interpolating points.
 * This prevents the chart from showing "all time" when a ranged view is selected
 * and the data has a large gap at the beginning of the range. It creates
 * simulated points for the start of the view and for the first of each month
 * within the gap to ensure the view remains focused on the selected time period.
 * @param {Array} history The user's weight history.
 * @param {string} graphView The selected view range (e.g., '3months', '6months').
 * @returns {object} Data formatted for Chart.js.
 */
function calculateWeightChartData(history, graphView) {
    const emptyReturn = { labels: [], values: [], timestamps: [], scaleMin: undefined, scaleMax: undefined };
    if (!history || history.length === 0) return emptyReturn;

    const sortedHistory = [...history].sort((a, b) => a.dateTime - b.dateTime);
    const unit = userSettings.weightUnit || 'kg';
    
    const isFocusView = ['week', '14days', 'month', '3months', '6months', 'year'].includes(graphView);

    if (graphView === 'alltime') {
        // All-time view doesn't need interpolation, just format the data.
        const data = sortedHistory.map(entry => {
            let value;
            if (unit === 'kg') value = entry.weightKg;
            else if (unit === 'lbs') value = kgToLbs(entry.weightKg);
            else {
                const { stone, pounds } = kgToStonePounds(entry.weightKg);
                value = stone + pounds / POUNDS_PER_STONE;
            }
            return { x: entry.dateTime.getTime(), y: value, isEstimate: !!entry.isEstimate };
        });
        return {
            labels: data.map(d => d.x),
            values: data,
            timestamps: data.map(d => d.x),
            scaleMin: undefined,
            scaleMax: undefined
        };
    }

    // Logic for ranged views (week, month, etc.)
    const now = new Date();
    const endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    let startDate;
    const y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
    switch(graphView) {
        case 'week': startDate = new Date(y, m, d - 6); break;
        case '14days': startDate = new Date(y, m, d - 13); break;
        case 'month': startDate = new Date(y, m - 1, d); break;
        case '3months': startDate = new Date(y, m - 3, d); break;
        case '6months': startDate = new Date(y, m - 6, d); break;
        case 'year': startDate = new Date(y - 1, m, d); break;
    }
    startDate.setHours(0, 0, 0, 0);

    // Find the original data points around our view window
    const lastEntryBefore = sortedHistory.filter(entry => entry.dateTime < startDate).pop();
    let filteredHistory = sortedHistory.filter(entry => entry.dateTime >= startDate && entry.dateTime <= endDate);
    const firstEntryInOrAfter = sortedHistory.find(entry => entry.dateTime >= startDate);

    const interpolatedPoints = [];

    // If there's a gap at the start of our range, create an interpolated point for the start date.
    if (lastEntryBefore && firstEntryInOrAfter && firstEntryInOrAfter.dateTime > startDate) {
        const timeDiff = firstEntryInOrAfter.dateTime.getTime() - lastEntryBefore.dateTime.getTime();
        const weightDiff = firstEntryInOrAfter.weightKg - lastEntryBefore.weightKg;

        // Only interpolate if the gap is reasonably large (e.g., > 1 day) to avoid weird artifacts
        if (timeDiff > 24 * 60 * 60 * 1000) {
            const dailyChange = weightDiff / (timeDiff / (1000 * 60 * 60 * 24));
            
            // Create an interpolated point for the start of the graph
            const daysFromLastPoint = (startDate.getTime() - lastEntryBefore.dateTime.getTime()) / (1000 * 60 * 60 * 24);
            const interpolatedWeight = lastEntryBefore.weightKg + (dailyChange * daysFromLastPoint);
            
            interpolatedPoints.push({
                dateTime: startDate,
                weightKg: interpolatedWeight,
                isEstimate: true
            });

            // User's request: add interpolated points for the first of each month within the gap
            let cursorDate = new Date(lastEntryBefore.dateTime);
            cursorDate.setDate(1); // Start from the 1st of the month of the last real point
            cursorDate.setMonth(cursorDate.getMonth() + 1); // Move to the next month

            while (cursorDate < firstEntryInOrAfter.dateTime) {
                // Only add if it's within our graph's view range
                if (cursorDate >= startDate && cursorDate <= endDate) {
                    const days = (cursorDate.getTime() - lastEntryBefore.dateTime.getTime()) / (1000 * 60 * 60 * 24);
                    const monthWeight = lastEntryBefore.weightKg + (dailyChange * days);
                    interpolatedPoints.push({
                        dateTime: new Date(cursorDate),
                        weightKg: monthWeight,
                        isEstimate: true,
                    });
                }
                // Move to the first of the next month
                cursorDate.setMonth(cursorDate.getMonth() + 1);
            }
        }
    }
    
    // Combine real and interpolated points, then sort
    let combinedHistory = [...filteredHistory, ...interpolatedPoints];
    combinedHistory.sort((a, b) => a.dateTime - b.dateTime);

    // Add a final point for 'today' if the last entry is before today, to extend the line
    const today = new Date();
    today.setHours(0,0,0,0);
    if (combinedHistory.length > 0) {
        const lastEntry = combinedHistory[combinedHistory.length - 1];
        const lastEntryDate = new Date(lastEntry.dateTime);
        lastEntryDate.setHours(0,0,0,0);

        if (lastEntryDate.getTime() < today.getTime() && endDate > today) {
             combinedHistory.push({
                dateTime: new Date(),
                weightKg: lastEntry.weightKg,
                isEstimate: true
            });
        }
    }

    if (combinedHistory.length === 0) return emptyReturn;

    // Convert to chart.js format
    const data = combinedHistory.map(entry => {
        let value;
        if (unit === 'kg') {
            value = entry.weightKg;
        } else if (unit === 'lbs') {
            value = kgToLbs(entry.weightKg);
        } else {
            const { stone, pounds } = kgToStonePounds(entry.weightKg);
            value = stone + pounds / POUNDS_PER_STONE;
        }
        return { x: entry.dateTime.getTime(), y: value, isEstimate: !!entry.isEstimate };
    });

    let scaleMin, scaleMax;
    if (isFocusView && data.length > 0) {
        const yValues = data.map(d => d.y);
        const minY = Math.min(...yValues);
        const maxY = Math.max(...yValues);
        const range = maxY - minY;
        const padding = Math.max(range * 0.1, 0.5); 
        scaleMin = minY - padding;
        scaleMax = maxY + padding;
    }

    return {
        labels: data.map(d => d.x),
        values: data,
        timestamps: data.map(d => d.x),
        scaleMin,
        scaleMax
    };
}


function calculateCurrentMedicationLevel(history) {
    const now = new Date();
    let currentLevel = 0;
    if (!Array.isArray(history)) history = [];
    const validHistory = history
        .map(shot => ({ ...shot, dateTime: shot.dateTime instanceof Date ? shot.dateTime : new Date(shot.dateTime), dose: String(shot.dose) }))
        .filter(shot => shot && shot.dateTime && !isNaN(shot.dateTime) && shot.medication && shot.dose);
    for (const shot of validHistory) {
        const hoursSinceDose = (now.getTime() - shot.dateTime.getTime()) / 3600000;
        if (hoursSinceDose < 0) continue;
        const dose = parseFloat(shot.dose);
        if (isNaN(dose) || dose <= 0) continue;
        const medInfo = medicationData[shot.medication];
        if (!medInfo || !medInfo.halfLife) continue;
        const { halfLife, timeToPeak = 0 } = medInfo;
        let concentration = (hoursSinceDose <= timeToPeak) ? (timeToPeak > 0 ? (hoursSinceDose / timeToPeak) * dose : dose) : dose * Math.pow(0.5, (hoursSinceDose - timeToPeak) / halfLife);
        if (!isNaN(concentration) && concentration > 0) {
            currentLevel += concentration;
        }
    }
    return isNaN(currentLevel) ? 0 : currentLevel;
}

function formatWeightDisplay(kgValue, unit, options = { showUnit: true }) {
    if (kgValue === null || isNaN(kgValue)) return 'N/A';
    
    let display;
    if (unit === 'kg') {
        display = `${kgValue.toFixed(1)}${options.showUnit ? ' kg' : ''}`;
    } else if (unit === 'lbs') {
        display = `${kgToLbs(kgValue).toFixed(1)}${options.showUnit ? ' lbs' : ''}`;
    } else if (unit === 'st-lbs') {
        const { stone, pounds } = kgToStonePounds(kgValue);
        display = `${stone} st ${pounds.toFixed(1)}${options.showUnit ? ' lbs' : ''}`;
    } else {
        display = 'N/A';
    }
    return display;
}

function calculateWeightStats() {
    const elements = getElements();
    const statElements = ['startWeightStat', 'goalWeightStat', 'toGoWeightStat', 'currentWeightStat', 'totalLostWeightStat', 'lostThisWeekStat', 'avgWeeklyLossStat'];
    statElements.forEach(id => { if (elements[id]) elements[id].textContent = 'N/A'; });
    if (elements.currentBmiLine) elements.currentBmiLine.style.display = 'none';
    if (weightHistory.length === 0) return;

    const sorted = [...weightHistory].sort((a, b) => a.dateTime - b.dateTime);
    const unit = userSettings.weightUnit || 'kg';
    const display = (kgValue) => formatWeightDisplay(kgValue, unit);

    const firstEntry = sorted[0];
    const lastEntry = sorted[sorted.length - 1];
    const startWeightKg = firstEntry.weightKg;
    const currentWeightKg = lastEntry.weightKg;
    const goalWeightKg = userSettings.goalWeight;

    elements.startWeightStat.textContent = display(startWeightKg);
    elements.currentWeightStat.textContent = display(currentWeightKg);
    elements.goalWeightStat.textContent = display(goalWeightKg);

    if (sorted.length > 1) {
        const totalLossKg = startWeightKg - currentWeightKg;
        elements.totalLostWeightStat.textContent = display(totalLossKg);
        if (goalWeightKg !== null) {
            elements.toGoWeightStat.textContent = display(currentWeightKg - goalWeightKg);
        }

        const targetDate = new Date(lastEntry.dateTime.getTime() - 7 * 24 * 60 * 60 * 1000);
        const previousEntries = sorted.slice(0, -1);
        if (previousEntries.length > 0) {
            const closestEntry = previousEntries.reduce((prev, curr) => {
                const prevDiff = Math.abs(prev.dateTime.getTime() - targetDate.getTime());
                const currDiff = Math.abs(curr.dateTime.getTime() - targetDate.getTime());
                return (currDiff < prevDiff) ? curr : prev;
            });

            if (closestEntry) {
                const lossSinceReference = closestEntry.weightKg - currentWeightKg;
                elements.lostThisWeekStat.textContent = display(lossSinceReference);
            } else {
                elements.lostThisWeekStat.textContent = "N/A";
            }
        } else {
            elements.lostThisWeekStat.textContent = "N/A";
        }

        const durationInMillis = lastEntry.dateTime.getTime() - firstEntry.dateTime.getTime();
        const durationInDays = durationInMillis / (1000 * 60 * 60 * 24);
        if (durationInDays >= 1 && totalLossKg > 0) {
            const avgLossPerWeek = (totalLossKg / durationInDays) * 7;
            elements.avgWeeklyLossStat.textContent = display(avgLossPerWeek);
        } else {
            elements.avgWeeklyLossStat.textContent = "N/A";
        }
    }

    if (userSettings.showBmi && userSettings.userHeight && currentWeightKg) {
        const heightM = userSettings.userHeight / 100;
        if (heightM > 0) {
            const bmi = currentWeightKg / (heightM * heightM);
            elements.currentBmiStat.textContent = bmi.toFixed(1);
            elements.currentBmiLine.style.display = 'block';
        }
    }
}


/*******************************
 * Update & Display Functions
 *******************************/
function updateMostRecentShotDisplay() {
    const elements = getElements();
    const sortedShots = [...shotHistory].filter(s => s.dateTime && !isNaN(new Date(s.dateTime))).sort((a, b) => new Date(b.dateTime) - new Date(a.dateTime));
    if (sortedShots.length > 0) {
        const mostRecent = sortedShots[0];
        const shotDate = new Date(mostRecent.dateTime);
        elements.lastShotDate.textContent = formatDate(shotDate);
        elements.lastShotTime.textContent = formatTime(shotDate);
        elements.lastShotMedication.textContent = mostRecent.medication || "N/A";
        elements.lastShotDose.textContent = mostRecent.dose ? `${mostRecent.dose}mg` : "N/A";
        const currentLevel = calculateCurrentMedicationLevel(shotHistory);
        elements.currentMedicationLevel.textContent = `${(mostRecent.medication || "Level")}: ${currentLevel.toFixed(3)}mg`;
        const nextShot = new Date(shotDate.getTime() + 7 * 24 * 60 * 60 * 1000);
        elements.nextShotDate.textContent = formatDate(nextShot);
        elements.nextShotTime.textContent = formatTime(shotDate);
        elements.nextShotMedication.textContent = mostRecent.medication || "N/A";
        elements.nextShotDose.textContent = mostRecent.dose ? `${mostRecent.dose}mg` : "N/A";
    } else {
        ['lastShotDate', 'lastShotTime', 'lastShotMedication', 'lastShotDose', 'currentMedicationLevel', 'nextShotDate', 'nextShotTime', 'nextShotMedication', 'nextShotDose'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.textContent = id === 'currentMedicationLevel' ? "Level: 0.000mg" : "N/A";
        });
    }
}

function updatePenStatusDisplay() {
    const elements = getElements();
    const sortedShots = [...shotHistory]
        .filter(s => s.dateTime && !isNaN(new Date(s.dateTime)))
        .sort((a, b) => new Date(b.dateTime) - new Date(a.dateTime));

    if (sortedShots.length === 0) {
        elements.penDosesRemaining.textContent = "N/A";
        elements.penEmptyDate.textContent = "N/A";
        return;
    }

    const lastShot = sortedShots[0];
    const currentDose = lastShot.dose;
    let consecutiveDoseCount = 0;

    for (const shot of sortedShots) {
        if (shot.dose === currentDose) {
            consecutiveDoseCount++;
        } else {
            break;
        }
    }

    const dosesUsedInCurrentPen = (consecutiveDoseCount - 1) % 4 + 1;
    const dosesRemaining = 4 - dosesUsedInCurrentPen;

    elements.penDosesRemaining.textContent = `${dosesRemaining} / 4`;

    if (dosesRemaining === 0) {
        elements.penEmptyDate.textContent = "New pen needed";
    } else {
        const lastShotDate = new Date(lastShot.dateTime);
        const daysUntilFinalDose = (dosesRemaining - 1) * 7;
        const finalDoseDate = new Date(lastShotDate.getTime());
        finalDoseDate.setDate(finalDoseDate.getDate() + daysUntilFinalDose);
        elements.penEmptyDate.textContent = formatDate(finalDoseDate);
    }
}

function getLastDoseForMedication(medication) {
    const medicationShots = shotHistory
        .filter(shot => shot.medication === medication && shot.dateTime && !isNaN(new Date(shot.dateTime)))
        .sort((a, b) => new Date(b.dateTime) - new Date(a.dateTime));
    return medicationShots[0]?.dose || null;
}

function updateDoseToLastUsed() {
    const elements = getElements();
    if (!elements.medicationSelect || !elements.doseSelect) return;
    const selectedMedication = elements.medicationSelect.value;
    const lastDose = getLastDoseForMedication(selectedMedication);
    if (lastDose !== null) {
        if (Array.from(elements.doseSelect.options).some(o => o.value === String(lastDose))) {
            elements.doseSelect.value = String(lastDose);
        }
    }
}

function updateWeightEntryUI() {
    const elements = getElements();
    const unit = userSettings.weightUnit;

    if (unit === 'st-lbs') {
        elements.weightEntrySingleContainer.style.display = 'none';
        elements.weightEntryStonePoundsContainer.style.display = 'block';
    } else {
        elements.weightEntrySingleContainer.style.display = 'block';
        elements.weightEntryStonePoundsContainer.style.display = 'none';
        elements.weightEntryUnit.textContent = unit;
    }
}

function updateDisplay() {
    const elements = getElements();
    if (!elements.graphViewSelect) return;

    elements.graphViewSelect.value = userSettings.medGraphView || 'month';
    elements.weightGraphViewSelect.value = userSettings.weightGraphView || 'month';

    initializeFlatpickr();

    const medChartData = calculateMedicationLevels(shotHistory, elements.graphViewSelect.value);
    createChart(medChartData);
    updateMostRecentShotDisplay();
    updatePenStatusDisplay();

    calculateWeightStats();
    const weightChartData = calculateWeightChartData(weightHistory, elements.weightGraphViewSelect.value);
    createWeightChart(weightChartData);
    updateWeightEntryUI();
}


/********************************
 * History & Settings Modal Logic
 ********************************/
function renderShotHistory() {
    const elements = getElements();
    const sortedHistory = [...shotHistory].filter(s => s.dateTime).sort((a, b) => new Date(b.dateTime) - new Date(a.dateTime));
    let modalContent = `<div class="modal-content"><span class="close-modal" data-modal-id="shotHistoryModal">&times;</span><h2>Shot History</h2><table id="shotHistoryTable"><thead><tr><th>Date</th><th>Time</th><th>Medication</th><th>Dose (mg)</th><th>Actions</th></tr></thead><tbody>`;
    if (sortedHistory.length > 0) {
        sortedHistory.forEach((shot) => {
            const originalIndex = shotHistory.findIndex(s => new Date(s.dateTime).getTime() === new Date(shot.dateTime).getTime() && s.medication === shot.medication && String(s.dose) === String(shot.dose));
            if (originalIndex !== -1) {
                modalContent += `<tr><td>${formatDate(new Date(shot.dateTime))}</td><td>${formatTime(new Date(shot.dateTime))}</td><td>${shot.medication}</td><td>${shot.dose}</td><td><button class="editShotButton" data-index="${originalIndex}">Edit</button></td></tr>`;
            }
        });
    } else {
        modalContent += `<tr><td colspan="5" style="text-align: center;">No shot history recorded.</td></tr>`;
    }
    modalContent += `</tbody></table><button type="button" class="close-modal-button" data-modal-id="shotHistoryModal">Close</button></div>`;
    elements.shotHistoryModal.innerHTML = modalContent;
    elements.shotHistoryModal.style.display = "block";
    elements.shotHistoryModal.querySelectorAll(".editShotButton").forEach(b => b.addEventListener("click", (e) => editShot(parseInt(e.target.dataset.index))));
}

function editShot(index) {
    const elements = getElements();
    const shot = shotHistory[index];
    if (!shot || !shot.dateTime) return;
    const shotDate = new Date(shot.dateTime);
    const medOptions = Object.keys(medicationData).map(k => `<option value="${k}" ${shot.medication === k ? "selected" : ""}>${k.charAt(0).toUpperCase() + k.slice(1)}</option>`).join('');
    const doseOptions = ["2.5", "5", "7.5", "10", "12.5", "15"].map(d => `<option value="${d}" ${String(shot.dose) === d ? "selected" : ""}>${d}mg</option>`).join('');
    const editContent = `<div class="modal-content"><span class="close-modal" data-modal-id="shotHistoryModal">&times;</span><h2>Edit Shot</h2>
        <div class="input-group"><label>Medication:</label><select id="editMedication">${medOptions}</select></div>
        <div class="input-group"><label>Dose:</label><select id="editDose">${doseOptions}</select></div>
        <div class="input-group"><label>Date:</label><input type="text" id="editDate"></div>
        <div class="input-group"><label>Time:</label><input type="text" id="editTime"></div>
        <div style="margin-top: 20px; display: flex; justify-content: space-between;">
             <div><button id="saveEdit">Save</button><button type="button" id="cancelEdit">Cancel</button></div>
             <button id="deleteShot" class="btn-danger">Delete</button>
        </div></div>`;
    elements.shotHistoryModal.innerHTML = editContent;
    const editDatePicker = flatpickr("#editDate", { dateFormat: flatpickrDateFormatMapping[userSettings.dateFormat], defaultDate: shotDate, altInput: true, altFormat: flatpickrDateFormatMapping[userSettings.dateFormat], allowInput: true });
    const editTimePicker = flatpickr("#editTime", { enableTime: true, noCalendar: true, dateFormat: flatpickrTimeFormatMapping[userSettings.timeFormat], defaultDate: shotDate, altInput: true, altFormat: flatpickrTimeFormatMapping[userSettings.timeFormat], time_24hr: userSettings.timeFormat === "24hr", allowInput: true });
    document.getElementById('saveEdit').addEventListener('click', () => {
        const newDate = editDatePicker.selectedDates[0];
        const newTime = editTimePicker.selectedDates[0];
        if (!newDate || !newTime) return;
        shotHistory[index] = {
            ...shotHistory[index],
            dateTime: new Date(newDate.getFullYear(), newDate.getMonth(), newDate.getDate(), newTime.getHours(), newTime.getMinutes()),
            medication: document.getElementById('editMedication').value,
            dose: String(document.getElementById('editDose').value)
        };
        saveData();
        renderShotHistory();
    });
    document.getElementById('deleteShot').addEventListener('click', () => {
        if (confirm("Are you sure you want to delete this shot?")) {
            shotHistory.splice(index, 1);
            saveData();
            renderShotHistory();
        }
    });
    document.getElementById('cancelEdit').addEventListener('click', renderShotHistory);
}

function renderWeightHistory() {
    const elements = getElements();
    const sortedHistory = [...weightHistory].sort((a, b) => b.dateTime - a.dateTime);
    const unit = userSettings.weightUnit || 'kg';
    let modalContent = `<div class="modal-content"><span class="close-modal" data-modal-id="weightHistoryModal">&times;</span><h2>Weight History</h2><table id="weightHistoryTable"><thead><tr><th>Date</th><th>Time</th><th>Weight</th><th>Actions</th></tr></thead><tbody>`;
    if (sortedHistory.length > 0) {
        sortedHistory.forEach((entry) => {
            const originalIndex = weightHistory.findIndex(w => w.dateTime.getTime() === entry.dateTime.getTime() && w.weightKg === entry.weightKg);
            if (originalIndex !== -1) {
                const displayWeight = formatWeightDisplay(entry.weightKg, unit);
                modalContent += `<tr><td>${formatDate(entry.dateTime)}</td><td>${formatTime(entry.dateTime)}</td><td>${displayWeight}</td><td><button class="editWeightButton" data-index="${originalIndex}">Edit</button></td></tr>`;
            }
        });
    } else {
        modalContent += `<tr><td colspan="4" style="text-align:center;">No weight history.</td></tr>`;
    }
    modalContent += `</tbody></table><button type="button" class="close-modal-button" data-modal-id="weightHistoryModal">Close</button></div>`;
    elements.weightHistoryModal.innerHTML = modalContent;
    elements.weightHistoryModal.style.display = 'block';
    elements.weightHistoryModal.querySelectorAll('.editWeightButton').forEach(btn => {
        btn.addEventListener('click', (e) => editWeightEntry(parseInt(e.target.dataset.index, 10)));
    });
}

function editWeightEntry(index) {
    const elements = getElements();
    const entry = weightHistory[index];
    if (!entry) return;

    const unit = userSettings.weightUnit || 'kg';
    let currentWeightDisplay;
    if (unit === 'kg') currentWeightDisplay = entry.weightKg.toFixed(1);
    else if (unit === 'lbs') currentWeightDisplay = kgToLbs(entry.weightKg).toFixed(1);
    
    const editContent = `<div class="modal-content"><span class="close-modal" data-modal-id="weightHistoryModal">&times;</span><h2>Edit Weight Entry</h2>
            <div class="input-group"><label for="editWeightDate">Date:</label><input type="text" id="editWeightDate"></div>
            <div class="input-group"><label for="editWeightTime">Time:</label><input type="text" id="editWeightTime"></div>
            <div class="input-group" id="editWeightSingleContainer" style="display: ${unit === 'st-lbs' ? 'none' : 'block'};">
                <label for="editWeightValue">Weight (${unit}):</label>
                <input type="number" id="editWeightValue" step="0.1" value="${currentWeightDisplay || ''}">
            </div>
            <div id="editWeightStonePoundsContainer" class="input-group multi-input-container" style="display: ${unit === 'st-lbs' ? 'block' : 'none'};">
                <label>Weight (stone / pounds):</label>
                <div>
                    <input type="number" id="editWeightStone" placeholder="st" class="multi-input">
                    <input type="number" id="editWeightPounds" step="0.1" placeholder="lbs" class="multi-input">
                </div>
            </div>
            <div style="margin-top: 20px; display: flex; justify-content: space-between;">
                 <div><button id="saveWeightEdit">Save Changes</button><button type="button" id="cancelWeightEdit">Cancel</button></div>
                 <button id="deleteWeightEntry" class="btn-danger">Delete Entry</button>
            </div></div>`;

    elements.weightHistoryModal.innerHTML = editContent;
    
    if (unit === 'st-lbs') {
        const { stone, pounds } = kgToStonePounds(entry.weightKg);
        document.getElementById('editWeightStone').value = stone;
        document.getElementById('editWeightPounds').value = pounds.toFixed(1);
    }

    const editDatePicker = flatpickr("#editWeightDate", {
        dateFormat: flatpickrDateFormatMapping[userSettings.dateFormat], defaultDate: entry.dateTime, altInput: true, altFormat: flatpickrDateFormatMapping[userSettings.dateFormat],
    });
    const editTimePicker = flatpickr("#editWeightTime", {
        enableTime: true, noCalendar: true, dateFormat: flatpickrTimeFormatMapping[userSettings.timeFormat], defaultDate: entry.dateTime, altInput: true, altFormat: flatpickrTimeFormatMapping[userSettings.timeFormat], time_24hr: userSettings.timeFormat === "24hr",
    });

    document.getElementById('saveWeightEdit').addEventListener('click', () => {
        const newDate = editDatePicker.selectedDates[0];
        const newTime = editTimePicker.selectedDates[0];
        let newWeightKg;

        if (unit === 'st-lbs') {
            const stone = parseFloat(document.getElementById('editWeightStone').value);
            const pounds = parseFloat(document.getElementById('editWeightPounds').value);
            newWeightKg = stonePoundsToKg(stone, pounds);
        } else {
            const newWeightValue = parseFloat(document.getElementById('editWeightValue').value);
            if (isNaN(newWeightValue)) { alert("Please enter a valid weight."); return; }
            newWeightKg = unit === 'kg' ? newWeightValue : lbsToKg(newWeightValue);
        }

        if (!newDate || !newTime || isNaN(newWeightKg)) {
            alert("Please ensure all fields are filled correctly."); return;
        }

        const combinedDateTime = new Date(newDate.getFullYear(), newDate.getMonth(), newDate.getDate(), newTime.getHours(), newTime.getMinutes());
        weightHistory[index].dateTime = combinedDateTime;
        weightHistory[index].weightKg = newWeightKg;
        weightHistory.sort((a,b) => a.dateTime - b.dateTime);
        saveData();
        renderWeightHistory();
    });

    document.getElementById('deleteWeightEntry').addEventListener('click', () => {
        if (confirm("Are you sure you want to delete this weight entry?")) {
            weightHistory.splice(index, 1);
            saveData();
            renderWeightHistory();
        }
    });

    document.getElementById('cancelWeightEdit').addEventListener('click', renderWeightHistory);
}

function populateSettingsModal() {
    const els = getElements();
    
    els.timeFormatSelect.value = tempSettings.timeFormat;
    els.dateFormatSelect.value = tempSettings.dateFormat;
    els.weekStartSelect.value = tempSettings.weekStart;
    els.showBmiToggle.checked = tempSettings.showBmi;
    els.weightUnitSelect.value = tempSettings.weightUnit;
    const goalKg = tempSettings.goalWeight;
    if (tempSettings.weightUnit === 'st-lbs') {
        els.goalWeightSingleContainer.style.display = 'none';
        els.goalWeightStonePoundsContainer.style.display = 'block';
        if (goalKg !== null && !isNaN(goalKg)) {
            const { stone, pounds } = kgToStonePounds(goalKg);
            els.goalWeightStone.value = stone;
            els.goalWeightPounds.value = pounds.toFixed(1);
        } else {
            els.goalWeightStone.value = '';
            els.goalWeightPounds.value = '';
        }
    } else {
        els.goalWeightSingleContainer.style.display = 'block';
        els.goalWeightStonePoundsContainer.style.display = 'none';
        els.goalWeightUnitLabel.textContent = tempSettings.weightUnit;
        if (goalKg !== null && !isNaN(goalKg)) {
            els.goalWeightInput.value = (tempSettings.weightUnit === 'kg' ? goalKg : kgToLbs(goalKg)).toFixed(1);
        } else {
            els.goalWeightInput.value = '';
        }
    }

    els.heightUnitSelect.value = tempSettings.heightUnit;
    const heightCm = tempSettings.userHeight;
    if (tempSettings.heightUnit === 'ft-in') {
        els.userHeightSingleContainer.style.display = 'none';
        els.userHeightFeetInchesContainer.style.display = 'block';
        if (heightCm !== null && !isNaN(heightCm)) {
            const { feet, inches } = cmToFeetInches(heightCm);
            els.userHeightFeet.value = feet;
            els.userHeightInches.value = inches.toFixed(1);
        } else {
            els.userHeightFeet.value = '';
            els.userHeightInches.value = '';
        }
    } else {
        els.userHeightSingleContainer.style.display = 'block';
        els.userHeightFeetInchesContainer.style.display = 'none';
        els.heightUnitLabel.textContent = 'cm';
        if (heightCm !== null && !isNaN(heightCm)) {
            els.userHeightInput.value = heightCm.toFixed(1);
        } else {
            els.userHeightInput.value = '';
        }
    }
}

function saveSettings() {
    const elements = getElements();
    
    const finalSettings = {};
    finalSettings.timeFormat = elements.timeFormatSelect.value;
    finalSettings.dateFormat = elements.dateFormatSelect.value;
    finalSettings.weekStart = elements.weekStartSelect.value;
    finalSettings.showBmi = elements.showBmiToggle.checked;
    finalSettings.weightUnit = elements.weightUnitSelect.value;
    finalSettings.heightUnit = elements.heightUnitSelect.value;

    if (finalSettings.weightUnit === 'st-lbs') {
        const stone = parseFloat(elements.goalWeightStone.value);
        const pounds = parseFloat(elements.goalWeightPounds.value);
        finalSettings.goalWeight = (isNaN(stone) && isNaN(pounds)) ? null : stonePoundsToKg(stone, pounds);
    } else {
        const goalWeightVal = parseFloat(elements.goalWeightInput.value);
        if (isNaN(goalWeightVal)) {
            finalSettings.goalWeight = null;
        } else {
            finalSettings.goalWeight = finalSettings.weightUnit === 'kg' ? goalWeightVal : lbsToKg(goalWeightVal);
        }
    }

    if (finalSettings.heightUnit === 'ft-in') {
        const feet = parseFloat(elements.userHeightFeet.value);
        const inches = parseFloat(elements.userHeightInches.value);
        finalSettings.userHeight = (isNaN(feet) && isNaN(inches)) ? null : feetInchesToCm(feet, inches);
    } else {
        const heightVal = parseFloat(elements.userHeightInput.value);
        finalSettings.userHeight = isNaN(heightVal) ? null : heightVal;
    }
    
    userSettings = JSON.parse(JSON.stringify(finalSettings));
    tempSettings = JSON.parse(JSON.stringify(finalSettings));

    saveData();
    
    const saveButton = elements.saveSettingsButton;
    const originalText = saveButton.textContent;
    saveButton.textContent = 'Saved!';
    saveButton.disabled = true;
    setTimeout(() => {
        saveButton.textContent = originalText;
        saveButton.disabled = false;
    }, 2000);
}

/********************************
 * Authentication UI & Actions
 ********************************/
function updateUIForLoginState() {
    const elements = getElements();
    const isLoggedIn = !!refreshToken;
    elements.loginButton.style.display = isLoggedIn ? 'none' : 'inline-block';
    elements.registerButton.style.display = isLoggedIn ? 'none' : 'inline-block';
    elements.logoutButton.style.display = isLoggedIn ? 'inline-block' : 'none';
    elements.userStatus.textContent = isLoggedIn ? `Logged in: ${currentUser?.username || 'User'}` : 'Not logged in (Local)';
    elements.userStatus.style.color = isLoggedIn ? '#4bc0c0' : '#ccc';
    if(elements.changePasswordButton) elements.changePasswordButton.style.display = isLoggedIn ? 'inline-block' : 'none';
}

function getCanonicalString(dataSet) {
    syncLog('getCanonicalString called with:', JSON.parse(JSON.stringify(dataSet)));
    if (!dataSet) {
        syncLog(' -> dataSet is null, returning null.');
        return null;
    }

    const dataCopy = JSON.parse(JSON.stringify(dataSet));

    const processedShots = (dataCopy.shotHistory || [])
        .map(s => ({ dateTime: new Date(s.dateTime).getTime(), dose: String(s.dose), medication: s.medication }))
        .sort((a, b) => a.dateTime - b.dateTime);
    const processedWeights = (dataCopy.weightHistory || [])
        .map(w => ({ dateTime: new Date(w.dateTime).getTime(), weightKg: Number(parseFloat(w.weightKg).toFixed(4)) }))
        .sort((a, b) => a.dateTime - b.dateTime);
    const settingsToCompare = {};
    const settingsKeys = Object.keys(defaultSettings).sort();
    for (const key of settingsKeys) {
        if (dataCopy.settings && dataCopy.settings[key] != null) {
            if (key === 'goalWeight' || key === 'userHeight') {
                settingsToCompare[key] = Number(parseFloat(dataCopy.settings[key]).toFixed(4));
            } else {
                settingsToCompare[key] = dataCopy.settings[key];
            }
        } else {
            settingsToCompare[key] = defaultSettings[key];
        }
    }
    const finalObject = { settings: settingsToCompare, shotHistory: processedShots, weightHistory: processedWeights };
    const finalString = JSON.stringify(finalObject);
    syncLog(' -> Canonical string generated:', finalString);
    return finalString;
}

function generateDataSummary(dataSet) {
    if (!dataSet) return { lastUpdate: 'N/A', shotCount: 0, weightCount: 0, lastShot: null, lastWeight: null, settings: {} };
    const sortedShots = [...(dataSet.shotHistory || [])].sort((a, b) => new Date(b.dateTime).getTime() - new Date(a.dateTime).getTime());
    const sortedWeights = [...(dataSet.weightHistory || [])].sort((a, b) => new Date(b.dateTime).getTime() - new Date(a.dateTime).getTime());
    const lastShot = sortedShots.length > 0 ? sortedShots[0] : null;
    const lastWeight = sortedWeights.length > 0 ? sortedWeights[0] : null;
    const lastShotDate = lastShot ? new Date(lastShot.dateTime) : null;
    const lastWeightDate = lastWeight ? new Date(lastWeight.dateTime) : null;
    let lastUpdate = null;
    if (lastShotDate && lastWeightDate) {
        lastUpdate = lastShotDate > lastWeightDate ? lastShotDate : lastWeightDate;
    } else {
        lastUpdate = lastShotDate || lastWeightDate;
    }
    return { lastUpdate: lastUpdate, shotCount: sortedShots.length, weightCount: sortedWeights.length, lastShot: lastShot, lastWeight: lastWeight, settings: dataSet.settings || {} };
}

function showSyncChoiceModal(localSummary, serverSummary, serverData) {
    const modal = document.getElementById('syncChoiceModal');
    if (!modal) return;
    const formatWeightDisplay = (weightEntry) => {
        if (!weightEntry) return 'N/A';
        const unit = userSettings.weightUnit || 'kg';
        const displayWeight = (unit === 'kg' ? weightEntry.weightKg : kgToLbs(weightEntry.weightKg)).toFixed(1);
        return `${formatDate(new Date(weightEntry.dateTime))} ${formatTime(new Date(weightEntry.dateTime))}: ${displayWeight} ${unit}`;
    };
    const formatShotDisplay = (shotEntry) => {
        if (!shotEntry) return 'N/A';
        return `${formatDate(new Date(shotEntry.dateTime))} ${formatTime(new Date(shotEntry.dateTime))}: ${shotEntry.dose}mg ${shotEntry.medication}`;
    };
    document.getElementById('localLastUpdate').textContent = localSummary.lastUpdate ? `${formatDate(localSummary.lastUpdate)} ${formatTime(localSummary.lastUpdate)}` : 'No entries';
    document.getElementById('localEntryCount').textContent = `${localSummary.shotCount} shots, ${localSummary.weightCount} weights`;
    document.getElementById('localLastShot').textContent = formatShotDisplay(localSummary.lastShot);
    document.getElementById('localLastWeight').textContent = formatWeightDisplay(localSummary.lastWeight);
    document.getElementById('serverLastUpdate').textContent = serverSummary.lastUpdate ? `${formatDate(serverSummary.lastUpdate)} ${formatTime(serverSummary.lastUpdate)}` : 'No entries';
    document.getElementById('serverEntryCount').textContent = `${serverSummary.shotCount} shots, ${serverSummary.weightCount} weights`;
    document.getElementById('serverLastShot').textContent = formatShotDisplay(serverSummary.lastShot);
    document.getElementById('serverLastWeight').textContent = formatWeightDisplay(serverSummary.lastWeight);
    const useLocalBtn = document.getElementById('useLocalDataBtn');
    const useServerBtn = document.getElementById('useServerDataBtn');
    const uploadHandler = async () => {
        syncLog("User chose to USE LOCAL data. Uploading to server...");
        await saveBackendData();
        modal.style.display = 'none';
    };
    const downloadHandler = () => {
        syncLog("User chose to USE SERVER data. Overwriting local data...");
        shotHistory = serverData.shotHistory;
        weightHistory = serverData.weightHistory;
        userSettings = serverData.settings;
        saveLocalData();
        updateDisplay();
        modal.style.display = 'none';
    };
    useLocalBtn.replaceWith(useLocalBtn.cloneNode(true));
    useServerBtn.replaceWith(useServerBtn.cloneNode(true));
    document.getElementById('useLocalDataBtn').addEventListener('click', uploadHandler);
    document.getElementById('useServerDataBtn').addEventListener('click', downloadHandler);
    modal.style.display = 'block';
}

async function handleLogin(event) {
    event.preventDefault();
    const elements = getElements();
    elements.loginError.textContent = '';
    const username = elements.loginUsernameInput.value.trim();
    const password = elements.loginPasswordInput.value;
    try {
        const response = await fetch(LOGIN_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        authToken = data.accessToken;
        refreshToken = data.refreshToken;
        localStorage.setItem(`${storagePrefix}authToken`, authToken);
        localStorage.setItem(`${storagePrefix}refreshToken`, refreshToken);
        currentUser = decodeJwtPayload(authToken);
        elements.loginModal.style.display = 'none';
        syncLog('Login successful. Starting data sync check.');
        const serverData = await fetchBackendData();
        const localData = { shotHistory, weightHistory, settings: userSettings };
        const hasLocalData = localData.shotHistory.length > 0 || localData.weightHistory.length > 0 || Object.keys(localData.settings).length > Object.keys(defaultSettings).length;
        const hasServerData = serverData && (serverData.shotHistory.length > 0 || serverData.weightHistory.length > 0 || Object.keys(serverData.settings).length > Object.keys(defaultSettings).length);
        if (hasLocalData && !hasServerData) {
            syncLog("Local data exists, but no server data. Prompting to upload.");
            if (confirm("No data found on server. Upload your local data to this account?")) {
                await saveBackendData();
            }
        } else if (hasServerData) {
            const localString = getCanonicalString(localData);
            const serverString = getCanonicalString(serverData);
            if (localString !== serverString) {
                syncLog('Data mismatch DETECTED. Showing sync choice modal.');
                const localSummary = generateDataSummary(localData);
                const serverSummary = generateDataSummary(serverData);
                showSyncChoiceModal(localSummary, serverSummary, serverData);
            } else {
                syncLog('Data is IN SYNC. No action needed.');
                shotHistory = serverData.shotHistory;
                weightHistory = serverData.weightHistory;
                userSettings = serverData.settings;
            }
        } else if (hasServerData && !hasLocalData) {
             syncLog("No local data, but server data exists. Downloading server data.");
             shotHistory = serverData.shotHistory;
             weightHistory = serverData.weightHistory;
             userSettings = serverData.settings;
        } else {
            syncLog("No data locally or on the server. Nothing to sync.");
        }
        saveLocalData();
        updateUIForLoginState();
        updateDisplay();
    } catch (error) {
        elements.loginError.textContent = error.message;
    }
}

async function handleRegister(event) {
    event.preventDefault();
    const elements = getElements();
    elements.registerError.textContent = '';
    const username = elements.registerUsernameInput.value.trim();
    const password = elements.registerPasswordInput.value;
    if (password !== elements.registerConfirmPasswordInput.value) {
        elements.registerError.textContent = 'Passwords do not match.'; return;
    }
    try {
        const response = await fetch(REGISTER_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        alert("Registration successful! Please log in.");
        elements.registerModal.style.display = 'none';
        elements.loginModal.style.display = 'block';
        elements.loginUsernameInput.value = username;
    } catch (error) {
        elements.registerError.textContent = error.message;
    }
}

async function logoutUser(logoutMessage = null) {
    const tokenToInvalidate = refreshToken;
    authToken = null; refreshToken = null; currentUser = null;
    localStorage.removeItem(`${storagePrefix}authToken`);
    localStorage.removeItem(`${storagePrefix}refreshToken`);
    if (logoutMessage) alert(logoutMessage);
    if (tokenToInvalidate) {
        try {
            await fetch(LOGOUT_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: tokenToInvalidate }) });
        } catch (error) { console.warn("Backend logout failed:", error); }
    }
    loadLocalData();
    updateUIForLoginState();
    updateDisplay();
}

async function handleChangePassword(event) {
    event.preventDefault();
    const elements = getElements();
    elements.changePasswordError.textContent = '';
    elements.changePasswordSuccess.textContent = '';
    const currentPassword = elements.currentPasswordInput.value;
    const newPassword = elements.newPasswordInput.value;
    if (newPassword !== elements.confirmNewPasswordInput.value) {
        elements.changePasswordError.textContent = 'New passwords do not match.';
        return;
    }
    try {
        const response = await fetchWithAuth(CHANGE_PASSWORD_ENDPOINT, { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        elements.changePasswordSuccess.textContent = data.message;
        setTimeout(() => logoutUser("Password changed. Please log in again."), 3000);
    } catch (error) {
        elements.changePasswordError.textContent = `Error: ${error.message}`;
    }
}

/********************************
 * Local File Sync Logic
 ********************************/
function showSyncStatus(message, type = "info") {
    const el = document.getElementById("syncStatus");
    if(el) { el.textContent = message; el.className = `sync-status-${type}`; setTimeout(() => {el.textContent=''; el.className='';}, 5000); }
}

function exportDataToFile() {
    const dataToExport = { shotHistory, weightHistory, userSettings };
    const blob = new Blob([JSON.stringify(dataToExport, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${APP_NAME}-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showSyncStatus("Data exported!", "success");
}

function importDataFromFile(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const data = JSON.parse(e.target.result);
            if (confirm("Import will overwrite current data in this browser. Proceed?")) {
                 if (data.shotHistory && data.userSettings && data.weightHistory) {
                    shotHistory = data.shotHistory.map(s => ({ ...s, dateTime: new Date(s.dateTime) }));
                    weightHistory = data.weightHistory.map(w => ({ ...w, dateTime: new Date(w.dateTime), weightKg: parseFloat(w.weightKg) })).filter(Boolean);
                    userSettings = { ...defaultSettings, ...data.userSettings };
                } else if (data.shotHistory && data.userSettings && data.userSettings.weightHistory) {
                    shotHistory = data.shotHistory.map(s => ({ ...s, dateTime: new Date(s.dateTime) }));
                    weightHistory = data.userSettings.weightHistory.map(w => ({ ...w, dateTime: new Date(w.dateTime), weightKg: parseFloat(w.weightKg) })).filter(Boolean);
                    delete data.userSettings.weightHistory;
                    userSettings = { ...defaultSettings, ...data.userSettings };
                } else {
                    throw new Error("Invalid file format");
                }
                saveLocalData();
                updateDisplay();
                showSyncStatus("Import successful!", "success");
                if(currentUser && confirm("Save imported data to your account? This will overwrite your current server data.")) {
                     await saveBackendData();
                }
            }
        } catch (error) {
            showSyncStatus(`Import failed: ${error.message}`, "error");
        }
    };
    reader.readAsText(file);
}

/********************************
 * Event Listeners Setup
 ********************************/
function setupEventListeners() {
    const elements = getElements();

    elements.viewModeCombinedBtn.addEventListener('click', () => {
        elements.medTrackerSection.classList.remove('hidden-section');
        elements.weightTrackerSection.classList.remove('hidden-section');
        document.querySelectorAll('.view-mode-controls button').forEach(b => b.classList.remove('active'));
        elements.viewModeCombinedBtn.classList.add('active');
    });
    elements.viewModeMedsBtn.addEventListener('click', () => {
        elements.medTrackerSection.classList.remove('hidden-section');
        elements.weightTrackerSection.classList.add('hidden-section');
        document.querySelectorAll('.view-mode-controls button').forEach(b => b.classList.remove('active'));
        elements.viewModeMedsBtn.classList.add('active');
    });
    elements.viewModeWeightBtn.addEventListener('click', () => {
        elements.medTrackerSection.classList.add('hidden-section');
        elements.weightTrackerSection.classList.remove('hidden-section');
        document.querySelectorAll('.view-mode-controls button').forEach(b => b.classList.remove('active'));
        elements.viewModeWeightBtn.classList.add('active');
    });

    elements.saveShotButton.addEventListener("click", () => {
        const shotDate = datePicker?.selectedDates[0];
        const shotTime = timePicker?.selectedDates[0];
        if (!shotDate || !shotTime) return alert("Please select date and time.");
        const combined = new Date(shotDate.getFullYear(), shotDate.getMonth(), shotDate.getDate(), shotTime.getHours(), shotTime.getMinutes());
        shotHistory.unshift({ dateTime: combined, medication: elements.medicationSelect.value, dose: elements.doseSelect.value });
        saveData();
        setTimeout(updateDoseToLastUsed, 100);
    });
    elements.medicationSelect.addEventListener("change", updateDoseToLastUsed);
    
    elements.graphViewSelect.addEventListener("change", (e) => {
        userSettings.medGraphView = e.target.value;
        saveData();
    });
    
    elements.shotHistoryButton.addEventListener("click", renderShotHistory);
    
    elements.saveWeightEntryButton.addEventListener('click', () => {
        const weightDate = weightDatePicker?.selectedDates[0];
        const weightTime = weightTimePicker?.selectedDates[0];
        if (!weightDate || !weightTime) {
            alert("Please select a date and time for the weight entry.");
            return;
        }
        
        let weightKg;
        const unit = userSettings.weightUnit;
        if (unit === 'st-lbs') {
            const stone = parseFloat(elements.weightEntryStone.value);
            const pounds = parseFloat(elements.weightEntryPounds.value);
            if (isNaN(stone) && isNaN(pounds)) {
                alert("Please enter a value for stone and/or pounds.");
                return;
            }
            weightKg = stonePoundsToKg(stone, pounds);
        } else {
            const weightValue = parseFloat(elements.weightValueInput.value);
            if (isNaN(weightValue)) {
                alert("Please enter a valid weight value.");
                return;
            }
            weightKg = unit === 'kg' ? weightValue : lbsToKg(weightValue);
        }

        const combinedDateTime = new Date(weightDate.getFullYear(), weightDate.getMonth(), weightDate.getDate(), weightTime.getHours(), weightTime.getMinutes());
        weightHistory.push({ dateTime: combinedDateTime, weightKg });
        weightHistory.sort((a,b) => a.dateTime - b.dateTime);
        
        elements.weightValueInput.value = '';
        elements.weightEntryStone.value = '';
        elements.weightEntryPounds.value = '';

        saveData();
    });
    elements.weightHistoryButton.addEventListener('click', renderWeightHistory);

    elements.weightGraphViewSelect.addEventListener('change', (e) => {
        userSettings.weightGraphView = e.target.value;
        saveData();
    });

    elements.loginButton.addEventListener('click', () => elements.loginModal.style.display = 'block');
    elements.registerButton.addEventListener('click', () => elements.registerModal.style.display = 'block');
    elements.logoutButton.addEventListener('click', () => logoutUser());
    elements.loginForm.addEventListener('submit', handleLogin);
    elements.registerForm.addEventListener('submit', handleRegister);
    
    elements.settingsButton.addEventListener("click", () => {
        tempSettings = JSON.parse(JSON.stringify(userSettings));
        populateSettingsModal();
        elements.changePasswordButton.style.display = authToken ? 'inline-block' : 'none';
        elements.settingsModal.style.display = "block";
    });

    elements.weightUnitSelect.addEventListener('change', (e) => {
        const newUnit = e.target.value;
        const oldUnit = tempSettings.weightUnit;
        const elements = getElements();
        let weightKg;

        if (oldUnit === 'st-lbs') {
            const stone = parseFloat(elements.goalWeightStone.value);
            const pounds = parseFloat(elements.goalWeightPounds.value);
            weightKg = stonePoundsToKg(stone, pounds);
        } else {
            const weightVal = parseFloat(elements.goalWeightInput.value);
            if (!isNaN(weightVal)) {
                weightKg = oldUnit === 'kg' ? weightVal : lbsToKg(weightVal);
            } else {
                weightKg = null;
            }
        }
        
        tempSettings.goalWeight = isNaN(weightKg) ? null : weightKg;
        tempSettings.weightUnit = newUnit;
        populateSettingsModal();
    });

    elements.heightUnitSelect.addEventListener('change', (e) => {
        const newUnit = e.target.value;
        const oldUnit = tempSettings.heightUnit;
        const elements = getElements();
        let heightCm;
        
        if (oldUnit === 'ft-in') {
            const feet = parseFloat(elements.userHeightFeet.value);
            const inches = parseFloat(elements.userHeightInches.value);
            heightCm = feetInchesToCm(feet, inches);
        } else {
            const heightVal = parseFloat(elements.userHeightInput.value);
            heightCm = isNaN(heightVal) ? null : heightVal;
        }

        tempSettings.userHeight = isNaN(heightCm) ? null : heightCm;
        tempSettings.heightUnit = newUnit;
        populateSettingsModal();
    });

    elements.saveSettingsButton.addEventListener("click", saveSettings);
    elements.changePasswordButton.addEventListener('click', () => elements.changePasswordModal.style.display = 'block');
    elements.changePasswordForm.addEventListener('submit', handleChangePassword);
    
    elements.localSyncButton.addEventListener('click', () => elements.syncModal.style.display = 'block');
    elements.exportDataButton.addEventListener('click', exportDataToFile);
    elements.importDataInput.addEventListener('change', importDataFromFile);

    document.body.addEventListener('click', function(e) {
        const modal = e.target.closest('.modal, .auth-modal, .sync-modal');
        if (!modal) return;
        
        if (modal.id === 'syncChoiceModal') {
            return;
        }

        const isCloseControl = e.target.matches('.close-modal, .close-auth-modal, .close-sync-modal, .close-modal-button, .close-auth-modal-button, .close-sync-modal-button');
        
        if (isCloseControl || e.target === modal) {
            modal.style.display = 'none';
        }
    });
}

/**********************
 * Initial Page Load
 **********************/
async function syncOnLoad() {
    if (!refreshToken) return;

    syncLog("Performing automatic sync on page load (server wins)...");
    try {
        const serverData = await fetchBackendData();
        syncLog('syncOnLoad: Fetched server data:', serverData ? JSON.parse(JSON.stringify(serverData)) : 'No server data');
        
        if (!serverData) {
            syncLog("syncOnLoad: Could not fetch server data for sync. Using existing local data.");
            return;
        }
        
        shotHistory = serverData.shotHistory;
        weightHistory = serverData.weightHistory;
        userSettings = serverData.settings;

        syncLog("syncOnLoad: Sync successful. Local data has been overwritten from server.");

        saveLocalData();
        updateDisplay();

    } catch (error) {
        console.error("An error occurred during automatic sync-on-load:", error);
    }
}

document.addEventListener("DOMContentLoaded", async () => {
    loadLocalData(); 
    initializeFlatpickr();
    setupEventListeners();
    authToken = localStorage.getItem(`${storagePrefix}authToken`);
    refreshToken = localStorage.getItem(`${storagePrefix}refreshToken`);

    if (refreshToken) {
        if (isTokenExpired(authToken)) {
            await attemptRefreshToken();
        } else {
            currentUser = decodeJwtPayload(authToken);
        }
        
        if (currentUser) {
            await syncOnLoad();
        }
    }
    
    updateUIForLoginState();
    updateDisplay();
    updateDoseToLastUsed();
});
