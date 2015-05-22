(function() {

/* Terminology: 
 * - Hit modifiers:    Array of elements detailing the type of hits (Miss, Good, Great or Perfect) required to
 *                     activate the captain ability of a specific unit. Provided via the `hitModifiers` property.
 *                     Must have 6 elements, each element the hit modifier to be used in the corresponding turn.
 *                     If provided, the unit must also specify how to apply its own captain
 *                     effect (via the `hitAtk` property)
 * - Bonus multiplier: Multiplier associated to each hit modifier (close to 1.9x for Perfect, close to 1.4x for Great, etc.)
 *                     Affected by the unit's effective attack and by the enemy's defense.
 * - Chain multiplier: Multiplier associated to the combo chain. Applied to each unit.
 *                     Increased by 0.3 when hitting Perfect's, by 0.1 when hitting Great's, left untouched
 *                     when hitting Good's and reset back to its initial value of 1.0 when hitting Misses.
 *                     Can be modified by captain effects (via chain modifier).
 * - Chain modifier:   Modifier applied to the chain multiplier when computing its new value.
 *                     Affects the amount the multiplier is increased by.
 *                     Typically a static value (eg 4.0 for Rayleigh, 2.0 for Domino).
 *                     Provided via the `chainModifier` property
 * - Orb multiplier:   Multiplier applied to the damage contribution of each unit, depending on the type of
 *                     the orb assigned to the unit itself.
 *                     Units with matching orbs get a 2.0 orb multiplier, units with opposite orbs get 0.5
 *                     and units with unrelated orbs get 1.0.
 *                     Can be modified by captain effects (eg SW Ace).
 *                     Provided via the `orbMultiplier` property.
 * - Type multiplier:  Multiplier applied to the damage contribution of each unit, depending on the type 
 *                     compatibility between the unit itself and the hypothetical enemy.
 *                     eg. STR units get a 2.0 type multiplier when calculating the damage on DEX enemies,
 *                     a 0.5 multiplier for QCK enemies and a 1.0 multiplier for all other enemies.
 *                     Cannot be modified by captain effects (so far).
 */

var DEFAULT_HIT_MODIFIERS = [ 'Perfect', 'Perfect', 'Perfect', 'Perfect', 'Perfect', 'Perfect' ]; 

var team = [ null, null, null, null, null, null ];
var captainAbilities = [ null, null ];

var merryBonus = 1;
var currentHP = 1;
var maxHP = 1;
var percHP = 100.0;

var crunchingEnabled = true;

var defenseThreshold = 0;

/* * * * * Crunching * * * * */

var crunch = function() {
    if (!crunchingEnabled) return;
    var result = { };
    ['STR','QCK','DEX','PSY','INT'].forEach(function(type) {
        result[type] = crunchForType(type,false);
    });
    result.HP = 0;
    team.forEach(function(x,n) {
        if (x == null) return;
        var hp = getHpOfUnit(x);
        result.HP += applyCaptainEffectsToHP(x,hp);
    });
    result.HP = Math.max(1,result.HP);
    $(document).trigger('numbersCrunched',result);
};

var crunchForType = function(type,withDetails) {
    var damage = [ ];
    // apply type & orb multipliers
    team.forEach(function(x,n) {
        if (x == null) return;
        var atk = getAttackOfUnit(x);
        damage.push([ x, atk * getOrbMultiplierOfUnit(x) * getTypeMultiplierOfUnit(x,type) * merryBonus , n ]);
    });
    // initialize ability array
    var abilities = [ ];
    if (captainAbilities[0] != null) abilities.push(captainAbilities[0]);
    if (captainAbilities[1] != null) abilities.push(captainAbilities[1]);
    // apply static multipliers and sort from weakest to stongest
    for (var i=0;i<abilities.length;++i) {
        if (!abilities[i].hasOwnProperty('atk'))  continue;
        damage = applyCaptainEffectToDamage(damage,abilities[i].atk);
    }
    damage.sort(function(x,y) { return x[1] - y[1]; });
    /*
     * 1st scenario: no captains with hit modifiers
     * -> We can just apply the chain and bonus multipliers and call it a day
     * 2nd scenario: 1 captain with hit modifiers
     * -> We need to check which hit modifiers (the captain's or the default ones) return the highest damage (2 checks)
     * -> The effect of the captain only applies if its modifiers are the same as the ones being used during the check
     * 3rd scenario: both captains with hit modifiers
     * -> We need to check which hit modifiers (the captains' or the default ones) return the highest damage (3 checks)
     * -> The effect of each captain only applies if their modifiers are the same as the ones being used during the check
     */
    var captainsWithHitModifiers = abilities.filter(function(x) { return x.hasOwnProperty('hitModifiers'); });
    var captainsWithChainModifiers = abilities.filter(function(x) { return x.hasOwnProperty('chainModifier'); });
    // get data struct ready
    var data = [ damage ];
    for (var i=0;i<captainsWithHitModifiers.length;++i) data.push(damage);
    // compute damages
    for (var i=0;i<data.length;++i) {
        var modifiers = (i == 0 ? DEFAULT_HIT_MODIFIERS : captainsWithHitModifiers[i-1].hitModifiers);
        // apply compatible captain effects
        for (var j=1;j<data.length;++j) {
            if (!arraysAreEqual(modifiers,captainsWithHitModifiers[j-1].hitModifiers)) continue;
            data[i] = applyCaptainEffectToDamage(data[i],captainsWithHitModifiers[j-1].hitAtk);
        }
        var damageWithChainMultipliers = applyChainAndBonusMultipliers(data[i],modifiers,captainsWithChainModifiers);
        var overallDamage = damageWithChainMultipliers.result.reduce(function(prev,x) { return prev + x[1]; },0);
        data[i] = { damage: damageWithChainMultipliers, overall: overallDamage, hitModifiers: modifiers };
    }
    // find index of maxiumum damage
    var index = 0, currentMax = data[0].overall;
    for (var i=1;i<data.length;++i) {
        if (data[i].overall < currentMax) continue;
        index = i;
        currentMax = data[i].overall;
    }
    // return results
    if (!withDetails) return currentMax;
    // provide details
    var result = {
        modifiers: data[index].hitModifiers,
        multipliers: data[index].damage.chainMultipliers,
        order: data[index].damage.result
    };
    return result;
}

/* * * * * * Utility functions * * * * */

var getAttackOfUnit = function(data) {
    var unit = data.unit;
    var level = data.level;
    return Math.floor(unit.minATK + (unit.maxATK - unit.minATK) / (unit.maxLevel == 1 ? 1 : (unit.maxLevel-1)) * (level-1));
};

var getHpOfUnit = function(data) {
    var unit = data.unit;
    var level = data.level;
    return Math.floor(unit.minHP + (unit.maxHP - unit.minHP) / (unit.maxLevel == 1 ? 1 : (unit.maxLevel-1)) * (level-1));
};

var setCaptain = function(slotNumber) {
    if (team[slotNumber] == null)
        captainAbilities[slotNumber] = null;
    else if (captains.hasOwnProperty(team[slotNumber].unit.number+1))
        captainAbilities[slotNumber] = createFunctions(captains[team[slotNumber].unit.number+1]);
    else
        captainAbilities[slotNumber] = null;
}

var createFunctions = function(data) {
    var result = { };
    for (key in data) {
        if (data[key] == undefined)
            $.notify("The captain you selected has a strange ass ability that can't be parsed correctly yet");
        else if (key != 'hitModifiers' && key != 'orb')
            result[key] = new Function('unit','chainPosition','currentHP','maxHP','percHP','modifier','return ' + data[key]);
        else if (key == 'orb')
            result[key] = new Function('unit','orb','return ' + data[key]);
        else
            result[key] = data[key];
    }
    return result;
};

var arraysAreEqual = function(a,b) {
    return a.length == b.length && a.every(function(x,n) { return x == b[n]; });
};

/* * * * * * Static multipliers/modifiers * * * * */

var getTypeMultiplierOfUnit = function(data,against) {
    var type = data.unit.type;
    if (type == 'STR' && against == 'DEX') return 2;
    if (type == 'STR' && against == 'QCK') return 0.5;
    if (type == 'QCK' && against == 'STR') return 2;
    if (type == 'QCK' && against == 'DEX') return 0.5;
    if (type == 'DEX' && against == 'QCK') return 2;
    if (type == 'DEX' && against == 'STR') return 0.5;
    if (type == 'INT' && against == 'PSY') return 2;
    if (type == 'PSY' && against == 'INT') return 2;
    return 1;
};

var getBonusMultiplier = function(hit) {
    if (hit == 'Perfect') return 1.9;
    if (hit == 'Great') return 1.4;
    if (hit == 'Good') return 0.9;
    return 1;
};

var getChainMultiplier = function(currentChainMultiplier,hit,chainModifier) {
    if (hit == 'Perfect') return currentChainMultiplier + 0.3 * chainModifier;
    else if (hit == 'Great') return currentChainMultiplier +  0.1 * chainModifier;
    else if (hit == 'Good') return currentChainMultiplier;
    return 1.0;
};

/* * * * * Captain effects * * * * */

var applyChainAndBonusMultipliers = function(damage,modifiers,captains) {
    // NOTE: all the captains provided must have a chain modifier (array can be empty - don't include them if they don't)
    var multipliersUsed = [ ];
    var currentChainMultiplier = 1.0;
    var result = damage.map(function(x,n) {
        var unit = x[0], damage = x[1], order = x[2];
        var result = damage * currentChainMultiplier;
        var chainModifier = captains.reduce(function(x,y) {
            return x * y.chainModifier(unit.unit,n,currentHP,maxHP,percHP,modifiers[n]);
        },1);
        result = computeDamageOfUnit(unit.unit,result,modifiers[n]);
        // update chain multiplier for the next hit
        multipliersUsed.push(currentChainMultiplier);
        currentChainMultiplier = getChainMultiplier(currentChainMultiplier,modifiers[n],chainModifier);
        // return value
        return [ unit, result, order ];
    });
    return { result: result, chainMultipliers: multipliersUsed };
};

var applyCaptainEffectToDamage = function(damage,func) {
    return damage.map(function(x,n) {
        var unit = x[0], damage = x[1], order = x[2];
        damage *= func(unit.unit,n,currentHP,maxHP,percHP);
        return [ unit, damage, order ];
    });
};

var applyCaptainEffectsToHP = function(unit,hp) {
    for (var i=0;i<2;++i) {
        if (captainAbilities[i] != null && captainAbilities[i].hasOwnProperty('hp'))
            hp *= captainAbilities[i].hp(unit.unit);
    }
    return hp;
};

var getOrbMultiplierOfUnit = function(data) {
    // TODO What happens with two captains with two different orb multipliers?
    for (var i=0;i<2;++i) {
        if (captainAbilities[i] != null && captainAbilities[i].hasOwnProperty('orb'))
            return captainAbilities[i].orb(data.unit,data.orb);
    }
    return data.orb;
};

/* The effective damage of a unit is affected by the hit modifier being used and by the defense threshold of an enemy.
 * The estimates being used right now are:
 * MISS hits: baseDamage * CMB
 * GOOD hits: baseDamage * (CMB - 2) + floor(startingDamage / CMB / merryBonus * 0.3) * CMB
 * GREAT hits: baseDamage * (CMB - 1) + floor(startingDamage / CMB / merryBonus * 0.6) * CMB 
 * PERFECT hits: baseDamage * CMB + floor(startingDamage / CMB / merryBonus * 1.35) * CMB
 * where:
 * - startingDamage is the damage computer for the unit, including the Merry's bonus
 * - baseDamage = floor(max(1,startingDamage / CMB - defenseThreshold))
 * The additional bonus for GOOD, GREAT and PERFECT (that is, the last hit in the chain) is apparently not
 * affected by the Merry's bonus, but seems to bypass the enemy's defense when it's higher than that (the
 * defense threshold is not applied if the damage is over the threshold itself)
 */
var computeDamageOfUnit = function(unit,unitAtk,hitModifier) {
    var baseDamage = Math.floor(Math.max(1,unitAtk / unit.combo - defenseThreshold));
    if (hitModifier == 'Miss')
        return baseDamage * unit.combo;
    if (hitModifier == 'Good') {
        var bonus = Math.floor(unitAtk / unit.combo / merryBonus * 0.3) * unit.combo;
        return baseDamage * (unit.combo - 2) + (bonus > defenseThreshold ? bonus : 1);
    } if (hitModifier == 'Great') {
        var bonus = Math.floor(unitAtk / unit.combo / merryBonus * 0.6) * unit.combo;
        return baseDamage * (unit.combo - 1) + (bonus > defenseThreshold ? bonus : 1);
    } if (hitModifier == 'Perfect') { 
        var bonus = Math.floor(unitAtk / unit.combo / merryBonus * 1.35) * unit.combo;
        return baseDamage * unit.combo + (bonus > defenseThreshold ? bonus : 1);
    }
};

/* * * * * Event callbacks * * * * */

var onUnitPick = function(event,slotNumber,unitNumber) {
    team[slotNumber] = { unit: units[unitNumber], level: 1, orb: 1 };
    if (slotNumber < 2) setCaptain(slotNumber);
    crunch();
};

var onLevelChange = function(event,slotNumber,level) {
    team[slotNumber].level = level;
    crunch();
};

var onMerryChange = function(event,bonus) {
    merryBonus = bonus;
    crunch();
};

var onDefenseChanged = function(event,value) {
    defenseThreshold = value;
    crunch();
}

var onHpChange = function(event,current,max,perc) {
    currentHP = current;
    maxHP = max;
    percHP = perc;
    crunch();
};

var onOrbMultiplierChanged = function(event,slotNumber,multiplier) {
    team[slotNumber].orb = multiplier;
    crunch();
};

var onUnitsSwitched = function(event,slotA,slotB) {
    var teamA = team[slotA];
    team[slotA] = team[slotB];
    team[slotB] = teamA;
    if (slotA == 0 || slotB == 0) setCaptain(0);
    if (slotA == 1 || slotB == 1) setCaptain(1);
    crunch();
};

var onUnitRemoved = function(event,slotNumber) {
    team[slotNumber] = null;
    if (slotNumber < 2) captainAbilities[slotNumber] = null;
    crunch();
};

var onDetailsRequested = function(event,type) {
    $(document).trigger('detailsReady',crunchForType(type.toUpperCase(),true));
};

var onCrunchToggled = function(event,enabled) {
    crunchingEnabled = enabled;
    if (enabled) crunch();
};

/* * * * * Events * * * * */

// core
$(document).on('unitPicked',onUnitPick);
$(document).on('unitLevelChanged',onLevelChange);
$(document).on('merryBonusUpdated',onMerryChange);
$(document).on('hpChanged',onHpChange);
$(document).on('defenseChanged',onDefenseChanged);
// loader
$(document).on('crunchingToggled',onCrunchToggled);
// orb control
$(document).on('orbMultiplierChanged',onOrbMultiplierChanged);
// drag & drop
$(document).on('unitsSwitched',onUnitsSwitched);
$(document).on('unitRemoved',onUnitRemoved);
// details
$(document).on('detailsRequested',onDetailsRequested);

})();
