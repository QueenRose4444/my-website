import { PRESET_MEDICATIONS } from '../constants';

// Basic constants for math
const POUNDS_PER_KG = 2.20462;
const POUNDS_PER_STONE = 14;

// --- Helper Functions ---
export const kgToLbs = kg => kg * POUNDS_PER_KG;
export const lbsToKg = lbs => lbs / POUNDS_PER_KG;

export function kgToStonePounds(kg) {
    if (kg === null || isNaN(kg)) return { stone: '', pounds: '' };
    const totalPounds = kg * POUNDS_PER_KG;
    const stone = Math.floor(totalPounds / POUNDS_PER_STONE);
    const pounds = totalPounds % POUNDS_PER_STONE;
    return { stone, pounds };
}

export function stonePoundsToKg(stone, pounds) {
    const s = parseFloat(stone) || 0;
    const p = parseFloat(pounds) || 0;
    const totalPounds = (s * POUNDS_PER_STONE) + p;
    return totalPounds / POUNDS_PER_KG;
}

/**
 * Calculates medication concentration levels over time.
 * @param {Array} history - Array of dose objects { dateTime: Date|string, dose: number, medication: string }
 * @param {string} graphView - 'week', 'month', '90days', 'alltime'
 * @param {Object} settings - User settings (weekStart, etc)
 * @param {Object} medData - Map of medication info (halfLife, etc)
 */
export function calculateMedicationLevels(history, graphView, settings, medData = PRESET_MEDICATIONS) {
    if (!Array.isArray(history)) history = [];
    
    // Normalize history
    const validHistory = history
        .map(shot => ({ 
            ...shot, 
            dateTime: shot.dateTime instanceof Date ? shot.dateTime : new Date(shot.dateTime), 
            dose: String(shot.dose) 
        }))
        .filter(shot => shot && shot.dateTime && !isNaN(shot.dateTime) && shot.medication && shot.dose);
        
    if (validHistory.length === 0) return { labels: [], values: [], timestamps: [] };

    const now = new Date();
    let startDate, endDate;
    validHistory.sort((a, b) => a.dateTime - b.dateTime);
    const firstShotDate = validHistory[0].dateTime;
    const lastShotDate = validHistory[validHistory.length - 1].dateTime;

    // View Range Logic
    switch (graphView) {
        case "week": {
            const weekDays = { "Sunday": 0, "Monday": 1, "Tuesday": 2, "Wednesday": 3, "Thursday": 4, "Friday": 5, "Saturday": 6 };
            const desiredStartDay = weekDays[settings.weekStart] || 0;
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
            
            // Try to find med info in the passed medData, handle generic/custom meds later
            // For now assuming the 'alltime' logic mainly looks at the last shot's med
            let medInfo = medData[lastShot.medication]; 
            // Fallback for custom generic meds if we implement them, 
            // they would be passed in medData which should be a merged object of Custom + Preset
            
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
    // Safety cap
    if (totalHours <= 0 || totalHours > 24 * 365 * 20) return { labels: [], values: [], timestamps: [] };

    const labels = [];
    const timestamps = [];
    const concentrationData = new Array(totalHours + 1).fill(0);

    for (let hour = 0; hour <= totalHours; hour++) {
        const currentDate = new Date(startDate.getTime() + hour * 3600000);
        timestamps.push(currentDate);
        labels.push(""); // Labels are usually formatted by chart callbacks
    }

    for (const shot of validHistory) {
        const { medication, dose, dateTime } = shot;
        // Lookup med info
        const medInfo = medData[medication];
        
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
                } else {
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
