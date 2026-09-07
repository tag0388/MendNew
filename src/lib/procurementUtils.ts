import { Calendar } from '../types';

/**
 * Checks if a given date is a working day based on the calendar.
 */
export function isWorkingDay(date: Date, calendar: Calendar): boolean {
  const day = date.getDay(); // 0 (Sun) - 6 (Sat)
  if (calendar.weekends.includes(day)) return false;
  
  const dateStr = date.toISOString().split('T')[0];
  if (calendar.holidays.includes(dateStr)) return false;
  
  return true;
}

/**
 * Adds business days to a date.
 */
export function addBusinessDays(startDate: string, days: number, calendar: Calendar): string {
  if (days === 0) return startDate;
  let date = new Date(startDate);
  let remainingDays = Math.abs(days);
  const direction = days > 0 ? 1 : -1;

  while (remainingDays > 0) {
    date.setDate(date.getDate() + direction);
    if (isWorkingDay(date, calendar)) {
      remainingDays--;
    }
  }
  
  return date.toISOString().split('T')[0];
}

/**
 * Subtracts business days from a date.
 */
export function subtractBusinessDays(startDate: string, days: number, calendar: Calendar): string {
  return addBusinessDays(startDate, -days, calendar);
}

/**
 * Recalculates all planned dates for a package (backward from last step).
 */
export function recalculatePlannedDates(
  stepData: Record<string, any>,
  steps: { id: string }[],
  calendar: Calendar
): Record<string, any> {
  const updatedData = { ...stepData };
  
  // Work backward from the last step
  for (let i = steps.length - 2; i >= 0; i--) {
    const currentStepId = steps[i].id;
    const nextStepId = steps[i + 1].id;
    const nextPlannedDate = updatedData[nextStepId]?.plannedDate;
    const duration = updatedData[currentStepId]?.planDuration || 0;
    
    if (nextPlannedDate) {
      updatedData[currentStepId] = {
        ...updatedData[currentStepId],
        plannedDate: subtractBusinessDays(nextPlannedDate, duration, calendar)
      };
    }
  }
  
  return updatedData;
}

/**
 * Recalculates all forecast dates for a package (forward from first step).
 */
export function recalculateForecastDates(
  stepData: Record<string, any>,
  steps: { id: string }[],
  calendar: Calendar,
  cutoffDate?: string
): Record<string, any> {
  const updatedData = { ...stepData };
  const effectiveCutoff = cutoffDate || new Date().toISOString().split('T')[0];
  
  // Work forward from the first step
  for (let i = 0; i < steps.length; i++) {
    const currentStepId = steps[i].id;
    const current = updatedData[currentStepId] || {};
    
    if (i === 0) {
      // First Step: IF(Actual="", IF(Planned > Cutoff, Planned, Cutoff), Actual)
      if (current.actualDate) {
        updatedData[currentStepId] = {
          ...current,
          forecastDate: current.actualDate
        };
      } else {
        const plannedDate = current.plannedDate || effectiveCutoff;
        // If planned date is in the future relative to cutoff, use it. Otherwise use cutoff.
        const basisValue = plannedDate > effectiveCutoff ? plannedDate : effectiveCutoff;
        updatedData[currentStepId] = {
          ...current,
          forecastDate: basisValue
        };
      }
    } else {
      // Subsequent steps: IF(Actual="", PrevForecast + PrevForecastDuration, Actual)
      if (current.actualDate) {
        updatedData[currentStepId] = {
          ...current,
          forecastDate: current.actualDate
        };
      } else {
        const prevStepId = steps[i - 1].id;
        const prev = updatedData[prevStepId] || {};
        const prevForecast = prev.forecastDate;
        const duration = prev.forecastDuration !== undefined ? prev.forecastDuration : (prev.planDuration || 0);
        
        if (prevForecast) {
          updatedData[currentStepId] = {
            ...current,
            forecastDate: addBusinessDays(prevForecast, duration, calendar)
          };
        }
      }
    }
  }
  
  return updatedData;
}
