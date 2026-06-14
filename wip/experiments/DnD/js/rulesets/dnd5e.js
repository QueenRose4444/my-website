window.DnD = window.DnD || {};

DnD.RULES_5E = Object.freeze({
  id: 'dnd5e',
  name: 'D&D 5e (2014)',
  abilities: [
    { id: 'str', label: 'Strength' },
    { id: 'dex', label: 'Dexterity' },
    { id: 'con', label: 'Constitution' },
    { id: 'int', label: 'Intelligence' },
    { id: 'wis', label: 'Wisdom' },
    { id: 'cha', label: 'Charisma' }
  ],
  races: [
    'Human', 'Elf', 'Dwarf', 'Halfling', 'Dragonborn', 'Gnome', 'Half-Elf',
    'Half-Orc', 'Tiefling', 'Aasimar', 'Goliath', 'Firbolg', 'Tabaxi', 'Triton',
    'Kenku', 'Lizardfolk', 'Genasi', 'Warforged', 'Centaur', 'Changeling',
    'Kalashtar', 'Shifter', 'Yuan-ti', 'Orc', 'Homebrew…'
  ],
  classes: [
    'Artificer', 'Barbarian', 'Bard', 'Cleric', 'Druid', 'Fighter', 'Monk',
    'Paladin', 'Ranger', 'Rogue', 'Sorcerer', 'Warlock', 'Wizard', 'Blood Hunter', 'Homebrew…'
  ],
  skills: [
    { id: 'acrobatics', label: 'Acrobatics', ability: 'dex' },
    { id: 'animalHandling', label: 'Animal Handling', ability: 'wis' },
    { id: 'arcana', label: 'Arcana', ability: 'int' },
    { id: 'athletics', label: 'Athletics', ability: 'str' },
    { id: 'deception', label: 'Deception', ability: 'cha' },
    { id: 'history', label: 'History', ability: 'int' },
    { id: 'insight', label: 'Insight', ability: 'wis' },
    { id: 'intimidation', label: 'Intimidation', ability: 'cha' },
    { id: 'investigation', label: 'Investigation', ability: 'int' },
    { id: 'medicine', label: 'Medicine', ability: 'wis' },
    { id: 'nature', label: 'Nature', ability: 'int' },
    { id: 'perception', label: 'Perception', ability: 'wis' },
    { id: 'performance', label: 'Performance', ability: 'cha' },
    { id: 'persuasion', label: 'Persuasion', ability: 'cha' },
    { id: 'religion', label: 'Religion', ability: 'int' },
    { id: 'sleightOfHand', label: 'Sleight of Hand', ability: 'dex' },
    { id: 'stealth', label: 'Stealth', ability: 'dex' },
    { id: 'survival', label: 'Survival', ability: 'wis' }
  ],
  proficiencyByLevel: (level) => DnD.proficiencyBonus(level)
});

// Merge homebrew into the base ruleset (non-destructive — returns a new object).
DnD.applyHomebrew = (base, homebrew) => {
  if (!homebrew || typeof homebrew !== 'object') return base;
  const merged = { ...base };
  if (Array.isArray(homebrew.extraRaces)) merged.races = [...base.races, ...homebrew.extraRaces];
  if (Array.isArray(homebrew.extraClasses)) merged.classes = [...base.classes, ...homebrew.extraClasses];
  if (Array.isArray(homebrew.extraSkills)) merged.skills = [...base.skills, ...homebrew.extraSkills];
  return merged;
};
