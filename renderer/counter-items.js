// Counter-item rules: an enemy threat (mechanic or hero) mapped to the items that answer it.
// Applicate in app.js contro i pick nemici + la tua build. Indicative, patch 7.3x.
window.COUNTER_RULES = [
  { id: 'invis', match: ['riki','bh','bounty','nyx','nyx_assassin','clinkz','weaver','mirana','smoke','invisible','shadow_blade','glimmer'], items: ['Dust of Appearance','Sentry Ward','Gem of True Sight'], why: "Per vedere chi diventa invisibile" },
  { id: 'heal', match: ['huskar','alchemist','morphling','necrolyte','necrophos','dazzle','io','chen','treant','undying','flesh_heap','lifesteal','pudge','abaddon','oracle'], items: ['Spirit Vessel','Shiva\'s Guard','Eye of Skadi'], why: "Riduce le cure e la rigenerazione" },
  { id: 'evasion', match: ['phantom_assassin','butterfly','halberd','heavens_halberd','pa','windranger','brewmaster','rix'], items: ['Monkey King Bar'], why: "Colpi sicuri contro l'evasione" },
  { id: 'magicburst', match: ['lina','lion','zeus','skywrath','skywrath_mage','tinker','puck','storm_spirit','queenofpain','leshrac','jakiro','ogre_magi'], items: ['Black King Bar','Glimmer Cape','Pipe of Insight'], why: "Per sopravvivere ai danni magici a raffica" },
  { id: 'physical', match: ['phantom_assassin','troll_warlord','ursa','monkey_king','slark','juggernaut','faceless_void','bloodseeker','phantom_lancer'], items: ['Ghost Scepter','Solar Crest','Heaven\'s Halberd','Blade Mail'], why: "Armatura e disarmo contro i danni fisici" },
  { id: 'stun_lock', match: ['earthshaker','lion','shadow_shaman','rhasta','faceless_void','enigma','magnus','tidehunter','ravage','black_hole'], items: ['Black King Bar','Linken\'s Sphere','Lotus Orb'], why: "Contro catene di stun e combo" },
  { id: 'illusioni', match: ['phantom_lancer','naga_siren','chaos_knight','terrorblade','spectre','manta'], items: ['Mjollnir','Radiance','Battle Fury'], why: "Danno ad area contro le illusioni" },
  { id: 'mana', match: ['antimage','nyx_assassin','keeper_of_the_light','kotl','medusa','wraith_king'], items: ['Arcane Boots','Falcon Blade','Linken\'s Sphere'], why: "Mana extra contro chi lo brucia" },
  { id: 'armor_neg', match: ['slardar','dazzle','shadow_fiend','nevermore','sniper','windranger','drow_ranger'], items: ['Assault Cuirass','Solar Crest','Crimson Guard'], why: "Armatura contro chi la riduce" },
  { id: 'regen', match: ['pudge','bristleback','tidehunter','centaur','dragon_knight'], items: ['Shiva\'s Guard','Eye of Skadi','Spirit Vessel'], why: "Contro eroi molto resistenti" },
];

window.HERO_THREATS = {
  npc_dota_hero_riki: ['invis'], npc_dota_hero_bounty_hunter: ['invis'],
  npc_dota_hero_clinkz: ['invis','physical'], npc_dota_hero_weaver: ['invis'],
  npc_dota_hero_phantom_assassin: ['evasion','physical'], npc_dota_hero_ursa: ['physical'],
  npc_dota_hero_troll_warlord: ['physical'], npc_dota_hero_monkey_king: ['physical'],
  npc_dota_hero_slark: ['physical','invis'], npc_dota_hero_juggernaut: ['physical'],
  npc_dota_hero_zeus: ['magicburst'], npc_dota_hero_lina: ['magicburst'],
  npc_dota_hero_lion: ['magicburst','stun_lock'], npc_dota_hero_skywrath_mage: ['magicburst'],
  npc_dota_hero_luna: ['illusioni'], npc_dota_hero_phantom_lancer: ['illusioni'],
  npc_dota_hero_naga_siren: ['illusioni'], npc_dota_hero_chaos_knight: ['illusioni'],
  npc_dota_hero_terrorblade: ['illusioni'], npc_dota_hero_antimage: ['mana'],
  npc_dota_hero_medusa: ['mana'], npc_dota_hero_slardar: ['armor_neg'],
  npc_dota_hero_dazzle: ['heal'], npc_dota_hero_necrolyte: ['heal'],
  npc_dota_hero_huskar: ['heal'], npc_dota_hero_bristleback: ['regen','physical'],
  npc_dota_hero_pudge: ['regen','heal'], npc_dota_hero_enigma: ['stun_lock'],
  npc_dota_hero_faceless_void: ['stun_lock','physical'], npc_dota_hero_tidehunter: ['stun_lock','regen'],
  npc_dota_hero_earthshaker: ['stun_lock'], npc_dota_hero_magnus: ['stun_lock'],
  npc_dota_hero_morphling: ['heal'], npc_dota_hero_spectre: ['illusioni','regen'],
  npc_dota_hero_windrunner: ['evasion','armor_neg'], npc_dota_hero_sniper: ['armor_neg'],
  npc_dota_hero_doom_bringer: ['regen', 'stun_lock'], npc_dota_hero_lycan: ['physical', 'illusioni'], npc_dota_hero_obsidian_destroyer: ['mana', 'magicburst'],
  npc_dota_hero_drow_ranger: ['armor_neg'], npc_dota_hero_storm_spirit: ['magicburst'],
  npc_dota_hero_queenofpain: ['magicburst'], npc_dota_hero_leshrac: ['magicburst'],
  npc_dota_hero_tinker: ['magicburst'], npc_dota_hero_puck: ['magicburst'],
};
