const periods = [
  {id: "P1", startDate: "2026-05-01", endDate: "2026-05-31"},
  {id: "P2", startDate: "2026-06-01", endDate: "2026-06-30"},
  {id: "P3", startDate: "2026-07-01", endDate: "2026-07-31"}
];

let userStart = new Date(Date.UTC(2026, 4, 1)); // May 1
let userEnd = new Date(Date.UTC(2026, 6, 31)); // Jul 31

const distributionPeriods = periods.slice(1);
let totalWorkingDaysInRange = 0;
let tempStep = new Date(userStart.getTime());
let workingDaysInPeriod = {};
let distIds = [];

while(tempStep <= userEnd) {
    const period = distributionPeriods.find(p => {
        const ps = new Date(p.startDate);
        const pe = new Date(p.endDate);
        return tempStep >= ps && tempStep <= pe;
    });
    if (period) {
        if (!workingDaysInPeriod[period.id]) {
            workingDaysInPeriod[period.id] = 0;
            distIds.push(period.id);
        }
        workingDaysInPeriod[period.id]++;
    }
    totalWorkingDaysInRange++;
    tempStep.setUTCDate(tempStep.getUTCDate() + 1);
}

console.log("Total working days:", totalWorkingDaysInRange);
console.log("distIds:", distIds);
console.log("workingDays:", workingDaysInPeriod);
