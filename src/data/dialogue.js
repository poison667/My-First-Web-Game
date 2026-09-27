// Dialogue lines are data-driven. The DialogueManager picks a greeting based on
// the player's relationship tier with that NPC, then offers context actions
// (chat, gift, ask about work, romance). Mission "talk" steps inject their own line.

export const DIALOGUE = {
  devon: {
    greetings: {
      hostile: ["Man, why you even talking to me?"],
      cold:    ["Hey. What's up."],
      neutral: ["Yo! What's good?", "Perfect timing, I was just thinking about you."],
      warm:    ["My favorite person! What's the plan?", "Ayy, the legend arrives."],
    },
    chat: ["You catch the game last night?", "This town, man. Never a dull day.", "Whatever you need, I got your back."],
  },
  mia: {
    greetings: {
      hostile: ["I don't really want to talk right now."],
      cold:    ["Oh. Hi."],
      neutral: ["Hey you. How's it going?", "Good to see you."],
      warm:    ["There you are! I missed you.", "Hey, you. Made my day already."],
    },
    chat: ["I've been reading this incredible book.", "Debate club is chaos this week.", "Do you ever just want to leave this town?"],
  },
  jade: {
    greetings: {
      hostile: ["Not in the mood. Move along."],
      cold:    ["Sup."],
      neutral: ["Hey. Wanna skate?", "Look who it is."],
      warm:    ["My favorite troublemaker. Let's cause some.", "You again? Good."],
    },
    chat: ["Landed a new trick yesterday.", "Art show's coming up. You should come.", "This town's boring without you."],
  },
  brett: {
    greetings: {
      hostile: ["You've got some nerve showing your face.", "Keep walking, nobody."],
      cold:    ["What do you want."],
      neutral: ["Huh. Didn't think you'd last.", "You're alright, I guess."],
      warm:    ["Respect. You earned it.", "Good to see you, partner."],
    },
    chat: ["This school's soft without competition.", "You actually got hands. Didn't expect that.", "Stay out of my way and we're good."],
  },
  coach_dan: {
    greetings: {
      cold:    ["Shape up, kid."],
      neutral: ["Ready to sweat?", "There's my player."],
      warm:    ["My star! Let's get to work.", "Proud of you, kid."],
    },
    chat: ["Winners are made in the off-season.", "No pain, no glory.", "Keep your head in the game."],
  },
  principal_hale: {
    greetings: {
      hostile: ["My office. Now. We need to talk about your record."],
      cold:    ["I'm watching you."],
      neutral: ["How are your studies?", "Stay on the right path."],
      warm:    ["A model student. Keep it up.", "Brackenridge is lucky to have you."],
    },
    chat: ["This school is only as good as its students.", "Reputation is everything.", "Make good choices."],
  },
  ms_portela: {
    greetings: {
      cold:    ["Homework. On my desk. Tomorrow."],
      neutral: ["How's the coursework?", "Chemistry waits for no one."],
      warm:    ["My best student. What can I do for you?", "Always a pleasure."],
    },
    chat: ["The periodic table is poetry.", "Study hard, the rest follows.", "I believe in you."],
  },
  liam: {
    greetings: {
      neutral: ["Oh hey! You need something?", "I was just debugging life."],
      warm:    ["My favorite accomplice! What's the mission?", "You always know when to show up."],
    },
    chat: ["I could hack the vending machine, theoretically.", "Robotics club nearly burned down the lab.", "Information is power, my friend."],
  },
  vince: {
    greetings: {
      cold:    ["You've got two minutes."],
      neutral: ["Ah, the ambitious one. Sit.", "Business or pleasure?"],
      warm:    ["My most trusted. Good. We have much to discuss.", "You've come far. I've noticed."],
    },
    chat: ["Loyalty is the only currency that matters.", "This town will be ours.", "Patience wins wars."],
  },
  knuckles: {
    greetings: {
      hostile: ["You lookin' to get hurt?"],
      cold:    ["What."],
      neutral: ["You got work for me or what?", "Heh. You again."],
      warm:    ["My kind of people. Let's break something.", "Respect."],
    },
    chat: ["Talkin's for people who can't fight.", "Vince says jump, I say how high.", "You're tougher than you look."],
  },
  tasha: {
    greetings: {
      cold:    ["Careful who you trust around here."],
      neutral: ["Got something for you. Interested?", "You're becoming useful."],
      warm:    ["My favorite operator. Let's make money.", "I knew you had it in you."],
    },
    chat: ["Everyone in this town owes someone.", "Play both sides, survive the middle.", "Information sells better than product."],
  },
  marcus: {
    greetings: {
      cold:    ["I don't know you well enough yet."],
      neutral: ["The Kings aren't the only power in town.", "You have potential. Don't waste it."],
      warm:    ["A rare mind. North Market values you.", "Together, we change everything."],
    },
    chat: ["Vince fights with fists. I fight with foresight.", "Every empire starts with one loyal soul.", "Think three moves ahead."],
  },
  rosa: {
    greetings: {
      neutral: ["Sit, eat something. Then we talk.", "You look like trouble. I like that."],
      warm:    ["Mi corazón! Coffee's on the house.", "You're family now. Careful out there."],
    },
    chat: ["I hear everything in this diner.", "Feed the body, the rest follows.", "Be careful who you become, niño."],
  },
  officer_reyes: {
    greetings: {
      hostile: ["I've got my eye on you. One slip."],
      cold:    ["Stay out of trouble."],
      neutral: ["This town's worth saving. Help me.", "You could do right, you know."],
      warm:    ["Good to have someone I can trust.", "You're one of the good ones."],
    },
    chat: ["Not every problem needs cuffs.", "I grew up on these streets too.", "Choose the harder right."],
  },
  clerk:    { greetings: { neutral: ["Welcome in! Take a look around."] }, chat: ["Best snacks in town, guaranteed."] },
  tailor:   { greetings: { neutral: ["Darling, let's get you dressed."] }, chat: ["Fashion is armor for the soul."] },
  gearhead: { greetings: { neutral: ["Tools, bats, whatever you need."] }, chat: ["No questions, just business."] },
  broker:   { greetings: { neutral: ["Buy, sell, or just browse?"] }, chat: ["Everything has a price."] },
};

export const GENERIC_GREETINGS = [
  "Hey there.", "Nice day, huh?", "Watch where you're going.", "Busy, busy.",
  "You from around here?", "Have a good one.", "Big things happening in town lately.",
];
