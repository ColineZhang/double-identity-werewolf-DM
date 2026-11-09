'use strict';
const { randomInt, randomUUID } = require('node:crypto');

const SEATS = 6;
const DECK = Object.freeze([
  'VILLAGER', 'VILLAGER', 'VILLAGER', 'VILLAGER', 'VILLAGER',
  'WOLF', 'HIDDEN_WOLF', 'SEER', 'WITCH', 'GUARD', 'STALKER', 'COPYCAT',
]);
const ROLES = Object.freeze({
  VILLAGER: '村民', WOLF: '普通狼人', HIDDEN_WOLF: '隐狼',
  SEER: '预言家', WITCH: '女巫', GUARD: '守卫',
  STALKER: '潜行者', COPYCAT: '复制人',
});
function isWolf(r) { return r === 'WOLF' || r === 'HIDDEN_WOLF'; }
function effective(pair) {
  const [a, b] = pair;
  if (a === 'COPYCAT' && b === 'COPYCAT') throw Error('不能复制另一张复制人');
  return [a === 'COPYCAT' ? b : a, b === 'COPYCAT' ? a : b];
}
function golden(pair) { return effective(pair).every(r => r === 'VILLAGER'); }
function legal(pair) {
  const eff = effective(pair);
  return !(eff.includes('SEER') && eff.some(isWolf)) &&
    !(pair.every(isWolf));
}
function layoutsFor(deck = DECK) {
  if (deck.length !== 12) throw Error('需要12张牌');
  const results = [];
  function walk(remaining, pairs, goldCount) {
    if (!remaining.length) {
      if (goldCount >= 1 && goldCount <= 2) results.push(pairs);
      return;
    }
    for (let i = 1; i < remaining.length; i++) {
      const pair = [remaining[0], remaining[i]];
      if (!legal(pair.map(index => deck[index]))) continue;
      const next = goldCount + Number(golden(pair.map(index => deck[index])));
      if (next > 2) continue;
      walk(remaining.filter(index => !pair.includes(index)), [...pairs, pair], next);
    }
  }
  walk(deck.map((_, i) => i), [], 0);
  return results;
}
const LAYOUTS = layoutsFor();
function shuffle(items) {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function deal() {
  const pairs = shuffle(LAYOUTS[randomInt(LAYOUTS.length)]);
  return pairs.map(pair => {
    const printed = pair.map(i => DECK[i]);
    const eff = effective(printed);
    return {
      team: eff.some(isWolf) ? 'WOLF' : 'VILLAGE',
      golden: eff.every(r => r === 'VILLAGER'),
      locked: false,
      cards: printed.map((role, i) => ({
        id: randomUUID(), printedRole: role, effectiveRole: eff[i],
        status: 'UNORDERED', order: null,
      })),
    };
  });
}
function lockOrder(hand, topCardId) {
  if (!hand || hand.locked) throw Error('无法再次锁定身份顺序');
  if (hand.cards.length !== 2) throw Error('身份牌数量错误');
  if (!hand.cards.some(c => c.id === topCardId)) throw Error('身份牌不属于当前玩家');
  const top = hand.cards.find(c => c.id === topCardId);
  if (hand.team === 'WOLF' && top.effectiveRole === 'WITCH') {
    throw Error('2023版规则要求狼人阵营的女巫放在第二身份');
  }
  const ordered = hand.cards.map(c => ({ ...c,
    order: c.id === topCardId ? 0 : 1,
    status: c.id === topCardId ? 'ACTIVE' : 'DORMANT',
  }));
  return { ...hand, cards: ordered, locked: true };
}
function publicCard(card) {
  return { id:card.id, printedRole:card.printedRole,
    effectiveRole:card.effectiveRole, printedLabel:ROLES[card.printedRole],
    effectiveLabel:ROLES[card.effectiveRole], status:card.status, order:card.order };
}
module.exports = { SEATS, DECK, ROLES, isWolf, effective, golden, legal, layoutsFor, deal, lockOrder, publicCard };
