/**
 * Ready-made boat names: "Pick one for me" on the phone, and the bots in demos and rehearsals.
 * All of them pass the name screen (src/commit/moderate.js), and none is a person's name.
 */
export const BOAT_NAMES = [
  'Brave Otter', 'Sea Spark', 'Kind Wave', 'Bright Tide', 'Little Lighthouse', 'Hope Sail', 'Tala',
  'Bituin', 'Alon', 'Silver Gull', 'Blue Dolphin', 'Sunny Breeze', 'Moon Skipper', 'Coral Star',
  'Bayanihan', 'Pag-asa', 'Liwanag', 'Golden Kite', 'Swift Heron', 'Calm Harbor', 'Safe Haven',
  'North Star', 'Rainbow Fin', 'Gentle Giant', 'Paper Crane', 'Busy Bee', 'Island Hopper',
  'Lucky Clover', 'Wonder Whale', 'Team Tutu', 'Starfish', 'Night Owl', 'Rising Sun', 'Smooth Sailor',
];

export const pickBoatName = () => BOAT_NAMES[Math.floor(Math.random() * BOAT_NAMES.length)];
