export const APP_NAME = 'med-tracker';
export const ENVIRONMENT = 'wip'; // or 'live'

export const defaultSettings = {
    dateFormat: "dd/mm/yyyy",
    timeFormat: "12hr",
    weekStart: "Sunday",
    medGraphView: 'month',
    weightUnit: "kg",
    heightUnit: "cm",
    goalWeight: null, // null means not set
    userHeight: null, // null means not set
    showBmi: false,
    weightGraphView: 'month',
    // New settings for shot location tracking
    shotLocationTrackingEnabled: true,
    shotLocationAbbreviations: true,
    shotLocationDisplay: 'both', // 'box', 'bar', or 'both'
    shotLocations: [
        'Left Arm', 'Right Arm',
        'Right Belly', 'Left Belly',
        'Left Thigh', 'Right Thigh'
    ]
};

// Initial data, can be expanded for the new generic system
export const PRESET_MEDICATIONS = {
    mounjaro: { 
        name: "Mounjaro",
        halfLife: 120, 
        timeToPeak: 48,
        color: "#4bc0c0",
        units: "mg",
        defaultDoses: [2.5, 5, 7.5, 10, 12.5, 15]
    },
    // Add more presets here as needed
};
