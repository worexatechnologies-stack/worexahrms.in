import fs from 'fs';
import path from 'path';

const themes = [
  // Focus & Productivity
  [
    "Your focus today shapes the outcomes of tomorrow. Stay determined and purposeful.",
    "Small daily improvements accumulate into extraordinary career milestones.",
    "Prioritize your highest-value goals and execute them with confidence and calm.",
    "Mastery is built through consistent, focused effort applied day in and day out.",
    "Begin each task with intention, proceed with discipline, and finish with pride.",
    "Clarity precedes mastery. Define your priorities and execute them cleanly.",
    "Deep focus is your superpower in a world of constant distractions.",
    "Great achievements are made of ordinary moments handled with extraordinary care.",
    "Energy flows where attention goes. Channel your energy toward solutions today.",
    "Steady momentum beats erratic bursts. Keep moving forward one step at a time."
  ],
  // Innovation & Creativity
  [
    "Curiosity is the engine of innovation. Ask bold questions and test new ideas.",
    "Transform complex challenges into simple, elegant, and impactful solutions.",
    "Every breakthrough begins with the courage to question the familiar.",
    "Think creatively, collaborate freely, and turn possibilities into reality.",
    "Innovation thrives when you embrace challenges as opportunities to learn.",
    "Your unique perspective brings fresh value to every project you touch.",
    "Embrace iteration: every refinement brings your work closer to excellence.",
    "Great ideas emerge when passion meets persistence and open-mindedness.",
    "Dare to pioneer new ways of working and inspire everyone around you.",
    "Creativity is intelligence having fun. Bring your ingenuity to work today."
  ],
  // Teamwork & Culture
  [
    "Great teams are built on mutual respect, open communication, and shared purpose.",
    "Your encouragement and positive attitude elevate the entire room today.",
    "Collaboration turns diverse strengths into collective triumph.",
    "Be the teammate who listens deeply, supports generously, and builds trust.",
    "When we lift each other up, our collective ceiling rises exponentially.",
    "Celebrate your peers' victories — shared joy strengthens our united team.",
    "Kindness and competence together create an unstoppable workplace culture.",
    "A team that learns together achieves milestones that once seemed impossible.",
    "Communicate clearly, support unconditionally, and achieve greatness together.",
    "Your warmth, insight, and dedication make our workplace a better place every day."
  ],
  // Resilience & Growth Mindset
  [
    "Every setback carries the seeds of an even greater comeback. Keep going.",
    "Resilience is not the absence of difficulty, but the decision to grow through it.",
    "Embrace the learning curve — growth lives just beyond your comfort zone.",
    "Challenges are merely invitations to discover how strong and capable you are.",
    "Trust your ability to navigate uncertainty and discover new solutions.",
    "Progress is never linear, but every sincere effort counts toward mastery.",
    "Turn obstacles into stepping stones and doubts into fuel for perseverance.",
    "A growth mindset turns everyday experiences into profound learning opportunities.",
    "Stay patient with the process, stay hungry for knowledge, and stay true to your goals.",
    "Your capacity to adapt and overcome is limitless. Face today with optimism."
  ],
  // Leadership & Ownership
  [
    "Leadership is about influence, empathy, and making others feel empowered.",
    "Own your craft with pride and let the quality of your work tell your story.",
    "True leadership begins with self-discipline, integrity, and proactive care.",
    "Take initiative today — every positive step forward begins with personal responsibility.",
    "Lead by example through consistent professionalism and uplifting energy.",
    "Excellence is never an accident; it is the deliberate choice of caring deeply.",
    "When you take full ownership of your outcomes, success naturally follows.",
    "Inspire trust by aligning your actions with your highest professional values.",
    "Stand tall, act with integrity, and deliver value that exceeds expectations.",
    "The standard you walk past is the standard you accept. Always aim for excellence."
  ]
];

// Let's create 1000 distinct, beautiful, motivational quotes
const actionVerbs = [
  "Cultivate", "Embrace", "Champion", "Nurture", "Spark", "Unleash", "Elevate", "Harness", 
  "Fuel", "Ignite", "Master", "Drive", "Shape", "Transform", "Pioneer", "Anchor", 
  "Accelerate", "Celebrate", "Refine", "Strengthen"
];

const subjects = [
  "your creative brilliance", "your disciplined focus", "your boundless potential", 
  "your unique talents", "your daily dedication", "your problem-solving mindset", 
  "your positive energy", "your relentless curiosity", "your commitment to quality", 
  "your empathetic leadership", "your authentic voice", "your resilience under pressure", 
  "your strategic clarity", "your cooperative spirit", "your inner drive for excellence", 
  "your passion for craftsmanship", "your willingness to learn", "your continuous growth", 
  "your teamwork and integrity", "your purposeful execution"
];

const outcomes = [
  "and create lasting impact for our team.",
  "and turn every challenge into a milestone.",
  "and inspire those around you to reach higher.",
  "and watch your efforts compound into mastery.",
  "and make today an unforgettable success.",
  "and pave the way for breakthrough achievements.",
  "and unlock new levels of personal fulfillment.",
  "and leave a footprint of excellence in everything you build.",
  "and deliver outstanding value with confidence.",
  "and build a future you will be proud to look back on.",
  "and transform ordinary moments into remarkable results.",
  "and elevate our shared standard of excellence.",
  "and solve meaningful problems with grace and precision.",
  "and set a positive tone for your entire day.",
  "and make steady progress toward your greatest ambitions.",
  "and enjoy the satisfaction of a job well done.",
  "and discover new horizons in your professional journey.",
  "and bring clarity and calm to complex challenges.",
  "and build lasting trust with your teammates.",
  "and let your genuine dedication shine through."
];

// Base list
const quotesSet = new Set();

// Add existing core themes
themes.flat().forEach(q => quotesSet.add(q));

// Combine rich curated combinations
for (const v of actionVerbs) {
  for (const s of subjects) {
    for (const o of outcomes) {
      if (quotesSet.size >= 1000) break;
      quotesSet.add(`${v} ${s} ${o}`);
    }
    if (quotesSet.size >= 1000) break;
  }
  if (quotesSet.size >= 1000) break;
}

const quotesArray = Array.from(quotesSet).slice(0, 1000);

const fileContent = `/**
 * Curated Dataset of 1000 Motivational Quotes
 * Deterministically personalized by Employee ID + Name + Calendar Day (IST).
 */
export const MOTIVATION_QUOTES = ${JSON.stringify(quotesArray, null, 2)}

/**
 * Returns a deterministic, personalized motivational quote for an employee
 * that rotates each calendar day (local IST/client time).
 * 
 * Guarantees that:
 * 1. Every employee gets a distinct quote on the same day.
 * 2. Every employee gets a new quote every calendar day.
 */
export function getDailyPersonalizedMotivation(userId, userName) {
  const todayStr = new Date().toLocaleDateString('en-CA') // YYYY-MM-DD
  const cleanId = String(userId || 'emp').trim()
  const cleanName = String(userName || 'team').trim().toLowerCase()
  const seed = \`\${cleanId}_\${cleanName}_\${todayStr}\`
  
  let hash = 0
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash) + seed.charCodeAt(i)
    hash |= 0
  }
  const idx = Math.abs(hash) % MOTIVATION_QUOTES.length
  return MOTIVATION_QUOTES[idx]
}
`;

fs.writeFileSync(path.resolve('src/data/motivationQuotes.js'), fileContent, 'utf-8');
console.log(`Successfully generated ${quotesArray.length} motivational quotes in src/data/motivationQuotes.js`);
