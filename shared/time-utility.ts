export function getUnixTime(date: Date): number {
  return Math.floor(date.getTime() / 1000)
}

export function getUnixTimeNow(): number {
  return getUnixTime(new Date())
}

export function getUnixTimeFromNow(ms: number): number {
  const future = new Date(Date.now() + ms)
  return getUnixTime(future)
}

export function getUnixTimeTomorrow(): number {
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  return getUnixTime(tomorrow)
}

export function getUnixTimeNextWeek(): number {
  const nextWeek = new Date()
  nextWeek.setDate(nextWeek.getDate() + 7)
  return getUnixTime(nextWeek)
}

export function getUnixTimeNextMonth(): number {
  const nextMonth = new Date()
  nextMonth.setMonth(nextMonth.getMonth() + 1)
  return getUnixTime(nextMonth)
}

export function getUnixTimeNextHalfYear(): number {
  const nextHalfYear = new Date()
  nextHalfYear.setMonth(nextHalfYear.getMonth() + 6)
  return getUnixTime(nextHalfYear)
}

export function getDateFromUnixTime(unixTime: number): Date {
  return new Date(unixTime * 1000)
}
