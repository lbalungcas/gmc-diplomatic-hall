/**
 * People's Choice booth logos shown on the vote map.
 * Files live in `public/booth-logos/{booth_no}.png`.
 * Only booths we have matched confidently are listed; missing = number-only square.
 */
export const BOOTH_LOGOS: Partial<Record<number, string>> = {
  1: '1.png', // D-KAWACH
  2: '2.png', // Voice 4 Change
  3: '3.png', // STEPS and RESPOND (STOP VAC handprint)
  4: '4.png', // ScreenSafe Stories
  5: '5.png', // Her Life, Her Choice
  6: '6.png', // Eco-Scouts (ChildFund)
  7: '7.png', // Secure Shield
  9: '9.png', // Gain Line
  10: '10.png', // Safe Scan (CPTSA / Project SAFE)
  12: '12.png', // SAFE Steps
  13: '13.png', // Zero Harm Tracker / Project CONEC
  14: '14.png', // PAUSE
  15: '15.png', // Balmanch / Children-led District Network
  16: '16.png', // SAFE Together
  17: '17.png', // Hearts On, Hands Off
  18: '18.png', // Red Ant Youth Movement
  19: '19.png', // YOUNG Hands
  20: '20.png', // Positive Discipline Champions (ChildFund Sri Lanka)
  21: '21.png', // Tiger - Empower Chatbot
  23: '23.png', // C4C (Children 4 Change)
  24: '24.png', // Global Youth-Led Movement on Ending Violence Against Children
};

export function boothLogoUrl(boothNo: number): string | null {
  const file = BOOTH_LOGOS[boothNo];
  return file ? `${import.meta.env.BASE_URL}booth-logos/${file}` : null;
}
