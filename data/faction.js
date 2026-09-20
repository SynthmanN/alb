// Фракционные войны: за фракционные очки у интенданта города покупаются гербы и сердца — детали фракционных плащей. Цены в очках
// одинаковы для всех фракций (данные пользователя). Очки у каждой фракции свои, покупать можно только предметы фракции, в которой состоишь.
// Рецепт фракционного плаща на любом тире: обычный плащ + герб (BP, зависит от тира) + одно сердце (жетон фракции, тира нет).
const HEART_POINTS = 3000;
const CREST_POINTS = { 4: 400, 5: 2250, 6: 3000, 7: 7500, 8: 15000 };

// id города-фракции → семейство плаща и id сердца
const FACTIONS = {
  MARTLOCK: { name: 'Мартлок', capeFamily: 'CAPEITEM_FW_MARTLOCK', heartId: 'T1_FACTION_HIGHLAND_TOKEN_1' },
  LYMHURST: { name: 'Лимхёрст', capeFamily: 'CAPEITEM_FW_LYMHURST', heartId: 'T1_FACTION_FOREST_TOKEN_1' },
  BRIDGEWATCH: { name: 'Бридгуотч', capeFamily: 'CAPEITEM_FW_BRIDGEWATCH', heartId: 'T1_FACTION_STEPPE_TOKEN_1' },
  FORTSTERLING: { name: 'Форт Стерлинг', capeFamily: 'CAPEITEM_FW_FORTSTERLING', heartId: 'T1_FACTION_MOUNTAIN_TOKEN_1' },
  THETFORD: { name: 'Тетфорд', capeFamily: 'CAPEITEM_FW_THETFORD', heartId: 'T1_FACTION_SWAMP_TOKEN_1' },
  CAERLEON: { name: 'Каэрлеон', capeFamily: 'CAPEITEM_FW_CAERLEON', heartId: 'T1_FACTION_CAERLEON_TOKEN_1' },
  BRECILIEN: { name: 'Бресилиен', capeFamily: 'CAPEITEM_FW_BRECILIEN', heartId: 'QUESTITEM_TOKEN_MISTS' },
};

// Очков на один плащ тира: сердце + герб этого тира (null — для тира нет цены герба)
function pointsPerCape(tier) {
  return CREST_POINTS[tier] === undefined ? null : HEART_POINTS + CREST_POINTS[tier];
}
// id герба плаща фракции: T4_CAPEITEM_FW_MARTLOCK → T4_CAPEITEM_FW_MARTLOCK_BP
const crestIdOf = (capeId) => `${capeId}_BP`;

module.exports = { HEART_POINTS, CREST_POINTS, FACTIONS, pointsPerCape, crestIdOf };
