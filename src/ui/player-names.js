// The player's name for online rooms (docs/flow-design.md section 3.12):
// typed in the name box of Play Online and Watch a match, kept in this
// browser under NAME_STORAGE_KEY, and a random friendly one when the box
// is left empty: an adjective and an animal, such as Sweet Ant (100 of
// each, so 10,000 names).

import { cleanName } from '../net/chat.js';

export const NAME_STORAGE_KEY = 'gomoku.player.name';

export const NAME_ADJECTIVES = Object.freeze([
  'Sweet', 'Brave', 'Calm', 'Clever', 'Cosy', 'Curious', 'Daring', 'Dreamy', 'Eager', 'Fancy',
  'Fluffy', 'Gentle', 'Giddy', 'Golden', 'Happy', 'Humble', 'Jolly', 'Kind', 'Lively', 'Lucky',
  'Merry', 'Mighty', 'Misty', 'Noble', 'Nimble', 'Patient', 'Peppy', 'Plucky', 'Polite', 'Proud',
  'Quick', 'Quiet', 'Rosy', 'Rustic', 'Shiny', 'Shy', 'Silly', 'Sleepy', 'Smart', 'Snowy',
  'Sparkly', 'Speedy', 'Spicy', 'Sunny', 'Swift', 'Tidy', 'Tiny', 'Witty', 'Zesty', 'Bold',
  'Breezy', 'Bright', 'Bubbly', 'Busy', 'Charming', 'Cheeky', 'Cheerful', 'Chilly', 'Crispy', 'Dapper',
  'Dizzy', 'Dusty', 'Fearless', 'Fierce', 'Fizzy', 'Friendly', 'Frosty', 'Funny', 'Fuzzy', 'Glowing',
  'Graceful', 'Grumpy', 'Hasty', 'Hidden', 'Honest', 'Hungry', 'Jazzy', 'Jumpy', 'Lazy', 'Lofty',
  'Lucid', 'Mellow', 'Minty', 'Modest', 'Moody', 'Mossy', 'Peaceful', 'Perky', 'Playful', 'Quirky',
  'Rapid', 'Restless', 'Royal', 'Rusty', 'Sassy', 'Silent', 'Sneaky', 'Steady', 'Wild', 'Wise',
]);

export const NAME_ANIMALS = Object.freeze([
  'Ant', 'Badger', 'Bat', 'Bear', 'Beaver', 'Bee', 'Beetle', 'Bison', 'Boar', 'Buffalo',
  'Bunny', 'Camel', 'Cat', 'Cheetah', 'Chick', 'Cobra', 'Cougar', 'Cow', 'Coyote', 'Crab',
  'Crane', 'Crow', 'Deer', 'Dingo', 'Dolphin', 'Donkey', 'Dove', 'Duck', 'Eagle', 'Eel',
  'Elephant', 'Elk', 'Falcon', 'Ferret', 'Finch', 'Fox', 'Frog', 'Gecko', 'Giraffe', 'Goat',
  'Goose', 'Gopher', 'Gorilla', 'Hamster', 'Hare', 'Hawk', 'Hedgehog', 'Heron', 'Hippo', 'Horse',
  'Hound', 'Ibis', 'Iguana', 'Jaguar', 'Jay', 'Kitten', 'Koala', 'Lamb', 'Lemur', 'Leopard',
  'Lion', 'Lizard', 'Llama', 'Lobster', 'Lynx', 'Magpie', 'Mole', 'Monkey', 'Moose', 'Moth',
  'Mouse', 'Newt', 'Octopus', 'Otter', 'Owl', 'Panda', 'Panther', 'Parrot', 'Peacock', 'Pelican',
  'Penguin', 'Pigeon', 'Puffin', 'Puma', 'Quail', 'Rabbit', 'Raccoon', 'Raven', 'Robin', 'Salmon',
  'Seal', 'Shark', 'Sheep', 'Sloth', 'Snail', 'Sparrow', 'Squirrel', 'Swan', 'Tiger', 'Turtle',
]);

// A random name: an adjective and an animal. random() returns [0, 1).
export function randomName(random = Math.random) {
  const pick = (list) => list[Math.min(list.length - 1, Math.floor(random() * list.length))];
  return `${pick(NAME_ADJECTIVES)} ${pick(NAME_ANIMALS)}`;
}

// The name saved in this browser, or null (none, or storage blocked).
export function loadName(storage) {
  try {
    return cleanName(storage?.getItem?.(NAME_STORAGE_KEY) ?? null);
  } catch {
    return null;
  }
}

// The name to play under for what the box holds: the cleaned text, or
// fallback (the random name the empty box suggests) when it is empty. It is
// saved for next time (a random one too, so the player keeps it).
export function chooseName(text, storage, fallback = randomName()) {
  const name = cleanName(text) ?? cleanName(fallback) ?? randomName();
  try {
    storage?.setItem?.(NAME_STORAGE_KEY, name);
  } catch {
    // a full or blocked storage: the name is only for this visit
  }
  return name;
}

// The players' names by stone, { X, O } (null for one not known), from a
// room view's seats and names ({ host, guest }), or null when no name is
// known. The same object comes back while they do not change, so a frame
// that compares by identity redraws nothing.
export function createPlayersByStone(seatStone) {
  let lastSeats = null;
  let lastNames = null;
  let players = null;
  return (view) => {
    if (view.seats === lastSeats && view.names === lastNames) return players;
    lastSeats = view.seats;
    lastNames = view.names;
    const names = view.names ?? {};
    if (!names.host && !names.guest) {
      players = null;
      return players;
    }
    players = {};
    for (const seat of ['host', 'guest']) {
      const stone = view.seats ? seatStone(view.seats, seat) : null;
      if (stone) players[stone] = names[seat] ?? null;
    }
    return players;
  };
}
