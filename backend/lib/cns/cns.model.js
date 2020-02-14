const { convertIsoDurationInDaysHoursMinutes, getHoursValue } = require('./helpers/duration');

class Cns {
}

class CnsValue {
  constructor(engagement, workingHours, isNonBusinessHours) {
    this.engagement = engagement;
    this.workingHours = workingHours;
    this.isNonBusinessHours = isNonBusinessHours;
    this.elapsedMinutes = 0;
  }

  getEngagementInHours() {
    if (!this.engagement) {
      return 0;
    }

    const { days, hours } = convertIsoDurationInDaysHoursMinutes(this.engagement);

    return getHoursValue(this.workingHours, days, hours);
  }

  getValueInHours() {
    getHoursValue(this.workingHours, this.days, this.hours);
  }
}

module.exports = { Cns, CnsValue };
