export type Lang = 'en' | 'he'

const strings: Record<Lang, Record<string, string>> = {
  en: {
    appTitle: 'Safest Route',
    from: 'From',
    to: 'To',
    placeholderAddress: 'Address or place',
    useMyLocation: 'Use my location',
    findRoute: 'Find safest route',
    findingRoute: 'Finding safest route…',
    routeOptions: 'Route options',
    safety: 'Alert risk in route',
    nearestShelters: 'Nearest shelters',
    showShelters: 'Show nearest shelters',
    timeToShelter: 'Time to shelter',
    rocketAlert: 'Rocket alert',
    close: 'Close',
    noShelters: 'No shelters found nearby.',
    loading: 'Loading…',
    legendHigh: 'High alert history',
    legendMedium: 'Medium',
    legendLow: 'Low',
    legendActive: 'Active alert zone',
    legendRoute: 'Safest route',
    legendShelter: 'Shelter',
    showHeatmap: 'Show alert history heatmap',
    zoneScore: 'Zone score',
    scoreOverall: 'Overall',
    scoreByTime: 'By time of day',
    scoreTimeLabel: 'Time',
    you: 'You',
    otherLocations: 'other locations',
    alertIn: 'Alert in',
    locations: 'locations',
    panelExpand: 'Show route panel',
    panelCollapse: 'Hide route panel',
  },
  he: {
    appTitle: 'המסלול הבטוח',
    from: 'מ',
    to: 'אל',
    placeholderAddress: 'כתובת או מקום',
    useMyLocation: 'מיקום נוכחי',
    findRoute: 'מצא מסלול בטוח',
    findingRoute: 'מחפש מסלול…',
    routeOptions: 'אפשרויות מסלול',
    safety: 'סבירות להתרעות בדרך',
    nearestShelters: 'מרחבים מוגנים קרובים',
    showShelters: 'הצג מרחבים מוגנים',
    timeToShelter: 'זמן למרחב מוגן',
    rocketAlert: 'התרעת טילים',
    close: 'סגור',
    noShelters: 'לא נמצאו מרחבים מוגנים בסביבה.',
    loading: 'טוען…',
    legendHigh: 'היסטוריית התראות גבוהה',
    legendMedium: 'בינוני',
    legendLow: 'נמוך',
    legendActive: 'אזור בהתראה',
    legendRoute: 'מסלול בטוח',
    legendShelter: 'מרחב מוגן',
    showHeatmap: 'הצג מפת היסטוריית התראות',
    zoneScore: 'ציון אזור',
    scoreOverall: 'כללי',
    scoreByTime: 'לפי שעה ביום',
    scoreTimeLabel: 'שעה',
    you: 'מיקומך',
    otherLocations: 'אזורים נוספים',
    alertIn: 'התראה ב',
    locations: 'אזורים',
    panelExpand: 'הצג פאנל מסלול',
    panelCollapse: 'הסתר פאנל',
  },
}

let currentLang: Lang = 'he'

export function setLang(lang: Lang) {
  currentLang = lang
  document.documentElement.lang = lang === 'he' ? 'he' : 'en'
  document.body.dir = lang === 'he' ? 'rtl' : 'ltr'
}

export function getLang(): Lang {
  return currentLang
}

export function t(key: string): string {
  return strings[currentLang]?.[key] ?? strings.en[key] ?? key
}
