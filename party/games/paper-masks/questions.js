// Paper Masks: the prompt deck, as plain data.
//
// Five packs. The first twelve prompts of each pack are the starter prompts from the rules
// (PAPER-MASKS-RULES.md, section 6); the last five of each are new. Every prompt carries:
//   id      stable, unique; a match never repeats one
//   pack    one of PACKS
//   text    the prompt as every phone shows it
//   family  true when it is safe for a family table (the family-safe subset)
//   best    true for the rules' ten "(best)" prompts
//   ghosts  two answers written in advance, for 3-player games (the "The game" card)
//
// SERVER ONLY: the ghost answers must never reach a page (rules, section 8, rule 10).
// A page that needs the prompt list imports `promptsForPage()` below, never QUESTIONS.

export const PACKS = [
  { id: "this-week", name: "This Week" },
  { id: "explain-yourself", name: "Explain Yourself" },
  { id: "tiny-confessions", name: "Tiny Confessions" },
  { id: "the-group", name: "The Group" },
  { id: "if-we", name: "If We" },
];

const q = (id, pack, text, ghosts, tags = {}) => ({
  id,
  pack,
  text,
  family: tags.family !== false,
  best: tags.best === true,
  ghosts,
});

const BEST = { best: true };
const ADULT = { family: false };

export const QUESTIONS = Object.freeze([
  // Pack 1: This Week
  q("week-01", "this-week", "A small win from this week that nobody congratulated you on.", ["Remembered to bring the reusable bags, both trips", "Got the lid off a jar on the first try"], BEST),
  q("week-02", "this-week", "The most boring thing you did this week, described as if it were thrilling.", ["Raced the washing machine to the end of its cycle and won", "Survived a forty-minute hold call with my sanity intact"], BEST),
  q("week-03", "this-week", "The best thing you ate this week.", ["A slightly burnt cheese toastie at midnight", "Leftover pasta, cold, straight from the fridge"]),
  q("week-04", "this-week", "A sentence you said this week that would sound strange out of context.", ["Please stop letting the cat answer the door", "I only need one more traffic cone"], ADULT),
  q("week-05", "this-week", "The last thing you searched for that you would happily say out loud.", ["How long do eggs really last", "Is a hot dog a sandwich"], ADULT),
  q("week-06", "this-week", "The first thing you thought about this morning.", ["Is it Saturday yet", "Did I leave the oven on last night"]),
  q("week-07", "this-week", "Something you meant to do this week and did not.", ["Return the library book I finished in June", "Call the dentist back"]),
  q("week-08", "this-week", "A song that was stuck in your head this week.", ["The theme tune from a cereal advert", "Happy birthday, for no reason at all"]),
  q("week-09", "this-week", "The best thing you overheard this week.", ["Someone on a bus explaining why owls are overrated", "I told you the goat would come back"], ADULT),
  q("week-10", "this-week", "Your week as a weather forecast.", ["Cloudy with a chance of naps", "Bright spells, then heavy showers of emails"]),
  q("week-11", "this-week", "Something you bought this week that you did not need.", ["A fourth phone charger", "A tiny cactus that is already struggling"]),
  q("week-12", "this-week", "A new opinion you formed this week.", ["Toast is better when cut into triangles", "Socks with sandals are actually fine"]),
  q("week-13", "this-week", "The best five minutes of your week.", ["The first sip of tea on Saturday morning", "Finding a parking space right outside"]),
  q("week-14", "this-week", "Something you did this week for the first time.", ["Ate an olive and admitted it was nice", "Read the instructions before building something"]),
  q("week-15", "this-week", "The app you opened most this week, and why.", ["The weather app, as if checking would change it", "Maps, because I still cannot find the new shop"]),
  q("week-16", "this-week", "A thing that annoyed you this week far more than it should have.", ["A sticker that would not peel off cleanly", "The one sock that went missing"]),
  q("week-17", "this-week", "A night out this week, summed up in three words.", ["Loud, late, worth it", "Snacks, songs, taxi"], ADULT),

  // Pack 2: Explain Yourself
  q("explain-01", "explain-yourself", "A rule you follow that nobody ever taught you.", ["Never trust a dry pavement in autumn", "Always sit facing the door"], BEST),
  q("explain-02", "explain-yourself", "Something you were completely sure was true as a kid.", ["Swallowed seeds grow into trees in your tummy", "The moon followed our car on purpose"], BEST),
  q("explain-03", "explain-yourself", "The strangest thing you have ever won.", ["A year's supply of birdseed", "A trophy for the tidiest tent"]),
  q("explain-04", "explain-yourself", "A food combination you will defend to anyone.", ["Chips dipped in a milkshake", "Peanut butter and banana on toast"]),
  q("explain-05", "explain-yourself", "A strange job you would secretly be good at.", ["Professional queue holder", "Naming new paint colours"]),
  q("explain-06", "explain-yourself", "A skill you have that has never once been useful.", ["Saying the alphabet backwards", "Wiggling one ear at a time"]),
  q("explain-07", "explain-yourself", "The worst present you have ever given.", ["A calendar, in March", "A plant that died before I handed it over"]),
  q("explain-08", "explain-yourself", "Something you keep for no good reason.", ["A drawer full of mystery cables", "Every jam jar I have ever emptied"]),
  q("explain-09", "explain-yourself", "The most unlikely place you have ever got lost.", ["A furniture shop, for two hours", "My own street, in the fog"]),
  q("explain-10", "explain-yourself", "The longest you have ever queued, and what for.", ["Three hours for a roller coaster that lasted a minute", "Forty minutes for a free doughnut"]),
  q("explain-11", "explain-yourself", "A small injury with a silly story behind it.", ["Sprained a thumb opening a crisp packet", "Bruised a knee on a beanbag, somehow"]),
  q("explain-12", "explain-yourself", "Something you learned from a video and used exactly once.", ["How to fold a shirt in two seconds", "How to open a coconut with a spoon"]),
  q("explain-13", "explain-yourself", "The worst job you have ever had, in five words.", ["Standing in the cold, smiling", "Dressed as a sandwich, handing leaflets"], ADULT),
  q("explain-14", "explain-yourself", "The pettiest thing you have ever done.", ["Hid the TV remote to win an argument", "Took the last biscuit just to prove a point"], ADULT),
  q("explain-15", "explain-yourself", "A hobby you dropped after one try.", ["Pottery, the wheel had other plans", "Juggling, mostly picking things up"]),
  q("explain-16", "explain-yourself", "The most useless fact you know by heart.", ["A group of flamingos is called a flamboyance", "Bananas are berries but strawberries are not"]),
  q("explain-17", "explain-yourself", "Your go-to karaoke song.", ["Something everyone can shout the chorus to", "The one with the very long note at the end"]),

  // Pack 3: Tiny Confessions
  q("confess-01", "tiny-confessions", "A word you said wrong for years.", ["Pacific instead of specific", "Ex-presso"], BEST),
  q("confess-02", "tiny-confessions", "The snack you would rather not share.", ["The last of the salted crisps", "Chocolate buttons, every single one"], BEST),
  q("confess-03", "tiny-confessions", "A film or show everyone loves that you never finished.", ["The one with the dragons", "That baking show, I only watched the first cake"]),
  q("confess-04", "tiny-confessions", "Something you nod along to but do not really understand.", ["How the offside rule works", "What a mortgage broker actually does"]),
  q("confess-05", "tiny-confessions", "A chore you secretly enjoy.", ["Pairing socks", "Hoovering in neat straight lines"]),
  q("confess-06", "tiny-confessions", "An everyday thing you still find tricky, like whistling or folding a fitted sheet.", ["Doing up a watch strap one-handed", "Knowing which way a USB stick goes in"]),
  q("confess-07", "tiny-confessions", "A song you know every word of and would never admit to choosing.", ["A boy band ballad from school discos", "The whole of a musical about cats"]),
  q("confess-08", "tiny-confessions", "The excuse you use most.", ["Sorry, the traffic was mad", "My phone was on silent"]),
  q("confess-09", "tiny-confessions", "Something harmless that you are a little bit scared of.", ["Balloons, just before they pop", "Geese, all of them"]),
  q("confess-10", "tiny-confessions", "How long you could honestly go without your phone.", ["About as long as a shower", "One whole day, if it is a beach day"]),
  q("confess-11", "tiny-confessions", "A trend you joined far too late.", ["Fidget spinners, last year", "Sourdough, after everyone stopped"]),
  q("confess-12", "tiny-confessions", "The thing you always forget to pack.", ["A toothbrush, every time", "Phone charger, then buy another one"]),
  q("confess-13", "tiny-confessions", "A lie you told to get out of plans.", ["Said I had a plumber coming round", "Claimed my car would not start"], ADULT),
  q("confess-14", "tiny-confessions", "The thing you pretend to like at work.", ["The team quiz on Fridays", "Decaf from the office machine"], ADULT),
  q("confess-15", "tiny-confessions", "A show you have rewatched more times than you would like to admit.", ["The sitcom with the coffee shop", "A cartoon about a talking dog"]),
  q("confess-16", "tiny-confessions", "The app you open without even thinking.", ["The weather, three times before breakfast", "Photos, to look at my own dog"]),
  q("confess-17", "tiny-confessions", "A word you still have to look up how to spell.", ["Necessary", "Rhythm, every single time"]),

  // Pack 4: The Group
  q("group-01", "the-group", "Our group's unofficial motto.", ["We will leave in five minutes, honest", "Snacks first, plans later"], BEST),
  q("group-02", "the-group", "The job this group would be worst at, all together.", ["Air traffic control", "Running a quiet library"], BEST),
  q("group-03", "the-group", "The thing we always end up talking about.", ["Food we have eaten and food we will eat", "That one holiday, again"]),
  q("group-04", "the-group", "The evening together you still think about.", ["The night the power went out and we played cards", "The barbecue in the rain"]),
  q("group-05", "the-group", "If this group were a restaurant, what it would serve.", ["Everything, slightly late", "Tapas, so nobody has to choose"]),
  q("group-06", "the-group", "A word that should be banned from our group chat.", ["Literally", "Quick question"], ADULT),
  q("group-07", "the-group", "What a stranger would guess we have in common.", ["We all lost the same bet", "A shared love of very long goodbyes"]),
  q("group-08", "the-group", "The one thing you would bring on a weekend away that nobody else would think of.", ["A bottle opener shaped like a fish", "Earplugs for the snorers"]),
  q("group-09", "the-group", "Our group as a kind of vehicle.", ["A minibus with one wobbly wheel", "A tandem bike nobody can steer"]),
  q("group-10", "the-group", "The first thing you remember about this group.", ["Someone got the date of the first meet-up wrong", "An argument about the best pizza topping"]),
  q("group-11", "the-group", "Where we will all be in ten years, in one sentence.", ["Same table, same jokes, better chairs", "Still trying to pick a restaurant"]),
  q("group-12", "the-group", "A rule we should add to this game next time.", ["Loser does the washing up", "Whoever reads has to do an accent"]),
  q("group-13", "the-group", "The emoji our group chat uses most, described in words.", ["The crying-laughing face, far too often", "A thumbs up, which means nothing"]),
  q("group-14", "the-group", "Our group's signature move at a party.", ["Taking over the kitchen", "Leaving last, very slowly"], ADULT),
  q("group-15", "the-group", "The film that should be made about us, and its title.", ["Five Minutes Late: The Movie", "Who Has The Keys"]),
  q("group-16", "the-group", "Something one of us always says.", ["I am nearly there", "Shall we just get chips"]),
  q("group-17", "the-group", "The best decision this group ever made.", ["Booking the cabin with the hot tub", "Starting the group chat in the first place"]),

  // Pack 5: If We
  q("ifwe-01", "if-we", "If we started a band, its name.", ["The Late Arrivals", "Snack Break"], BEST),
  q("ifwe-02", "if-we", "If we had a team mascot, what it would be.", ["A very confused pigeon", "A sloth wearing a cape"], BEST),
  q("ifwe-03", "if-we", "If we opened a shop, what it would sell.", ["Only left shoes", "Board games with missing pieces"]),
  q("ifwe-04", "if-we", "If we were stuck in a lift for a day, the one thing you would want in your pocket.", ["A pack of cards", "A very long chocolate bar"]),
  q("ifwe-05", "if-we", "If we won a trip tomorrow, where you would want to go.", ["Somewhere with a hammock and no signal", "A road trip with no plan at all"]),
  q("ifwe-06", "if-we", "If we were the crew in a heist film, your job.", ["The one who brings snacks for the getaway", "Distraction, by talking far too much"]),
  q("ifwe-07", "if-we", "If we swapped kitchens for a week, the one thing you would miss.", ["My good knife", "The toaster that knows me"]),
  q("ifwe-08", "if-we", "If we entered a talent show, your act.", ["Naming every capital city, badly", "Balancing a spoon on my nose"]),
  q("ifwe-09", "if-we", "If we were snowed in, the game you would make everyone play.", ["Charades, with very strict rules", "A board game that takes six hours"]),
  q("ifwe-10", "if-we", "If we all lived on one island, the one law you would pass.", ["Naps are compulsory after lunch", "Nobody may hum the same song twice"]),
  q("ifwe-11", "if-we", "If we wrote a cookbook together, your recipe in it.", ["Toast, three ways", "Emergency pasta with whatever is left"]),
  q("ifwe-12", "if-we", "If we each had a theme tune, yours in three words.", ["Slow, dramatic, hopeful", "Kazoo solo, loudly"]),
  q("ifwe-13", "if-we", "If we ran a pub, its name.", ["The Wobbly Stool", "The Last Orders Inn"], ADULT),
  q("ifwe-14", "if-we", "If we were a sports team, the sport we would actually win at.", ["Competitive picnicking", "Hide and seek, the long version"]),
  q("ifwe-15", "if-we", "If we started a yearly tradition, what it would be.", ["A pancake race on the first sunny day", "The worst jumper party"]),
  q("ifwe-16", "if-we", "If we had our own reality show, its title.", ["Nobody Knows the Plan", "Keeping Up With the Group Chat"]),
  q("ifwe-17", "if-we", "If we were in a film about a robot uprising, your role.", ["The one who reads the manual", "Hiding in the cupboard with snacks"]),
]);

export const QUESTION_BY_ID = Object.freeze(Object.fromEntries(QUESTIONS.map((x) => [x.id, x])));

/** The prompt list without the ghost answers, safe to ship in page code. */
export function promptsForPage() {
  return QUESTIONS.map(({ id, pack, text, family, best }) => ({ id, pack, text, family, best }));
}
