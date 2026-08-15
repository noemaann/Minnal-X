/**
 * Powers Module for MINNAL-X
 * Implements a modular superpower engine coordinating active states,
 * cooldown protections, and visual/audio triggers.
 */

export const POWER_CATALOG = [
  {
    id: 'LIGHTNING_BOLT',
    name: 'LIGHTNING BOLT',
    gesture: 'POINT',
    gestureDisplay: 'POINT ☝️',
    description: 'Shoots a high-voltage lightning discharge.',
    key: 'Q'
  },
  {
    id: 'LIGHTNING_SHIELD',
    name: 'LIGHTNING SHIELD',
    gesture: 'OPEN_PALM',
    gestureDisplay: 'OPEN PALM ✋',
    description: 'Surrounds the user with a protective energy barrier.',
    key: 'W'
  },
  {
    id: 'POWER_BLAST',
    name: 'POWER BLAST',
    gesture: 'FIST',
    gestureDisplay: 'OPEN➔FIST ✊',
    description: 'Discharges a radial shockwave of pure force.',
    key: 'E'
  },
  {
    id: 'THUNDER_MODE',
    name: 'THUNDER MODE',
    gesture: 'TWO_FINGER',
    gestureDisplay: 'TWO FINGER ✌️',
    description: 'Overcharges the energy capacitor to maximum power.',
    key: 'R'
  }
];

export class Superpower {
  /**
   * @param {Object} options Configuration parameters.
   * @param {string} options.name Public name of the power.
   * @param {string} options.description Description of the action.
   * @param {string} options.activationGesture Gesture identifier triggering this power.
   * @param {number} options.cooldown Cooldown protection threshold in milliseconds.
   * @param {Function} [options.onActivate] Triggered once on activation.
   * @param {Function} [options.onUpdate] Triggered every frame while held active.
   * @param {Function} [options.onCleanup] Triggered once on release/cleanup.
   */
  constructor(options) {
    this.name = options.name;
    this.description = options.description;
    this.activationGesture = options.activationGesture;
    this.cooldown = options.cooldown || 1000;
    
    this.lastActivatedTime = 0;
    this.isActive = false;

    // Custom callbacks
    this.onActivate = options.onActivate || (() => {});
    this.onUpdate = options.onUpdate || (() => {});
    this.onCleanup = options.onCleanup || (() => {});
  }

  /**
   * Evaluates if cooldown protection is cleared.
   * @param {number} timestamp Current performance timestamp in ms.
   * @returns {boolean}
   */
  canActivate(timestamp) {
    return timestamp - this.lastActivatedTime >= this.cooldown;
  }

  /**
   * Fires the activation callback.
   */
  activate(timestamp, effects, audio) {
    if (!this.canActivate(timestamp)) return false;
    this.lastActivatedTime = timestamp;
    this.isActive = true;
    console.log(`[Superpower Engine] Firing activation for: ${this.name}`);
    this.onActivate(effects, audio);
    return true;
  }

  /**
   * Fires the continuous frame callback.
   */
  update(effects, audio) {
    if (this.isActive) {
      this.onUpdate(effects, audio);
    }
  }

  /**
   * Fires the cleanup callback.
   */
  cleanup(effects, audio) {
    if (this.isActive) {
      console.log(`[Superpower Engine] Cleaning up power: ${this.name}`);
      this.isActive = false;
      this.onCleanup(effects, audio);
    }
  }
}

export class SuperpowersManager {
  constructor() {
    // Dynamic charging parameters
    this.chargeLevel = 0.0;
    this.isCharging = false;
    this.activePower = null;

    // Shield visual parameters
    this.shieldOpacity = 0.0;
    this.shieldAngle = 0.0;

    // Transition tracking
    this.prevGesture = 'UNKNOWN';

    // System mode state machine
    this.systemMode = 'NORMAL';
    this.thunderStartTime = 0;
    this.depletedStartTime = 0;
    this.thunderDuration = 5000;
    this.depletedDuration = 2000;

    // Power Selection State
    this.selectedPowerIndex = 0; // Default to LIGHTNING_BOLT

    // Instantiate and register superpowers
    this.powers = {
      LIGHTNING_BOLT: new Superpower({
        name: 'LIGHTNING_BOLT',
        description: 'Shoots a high-voltage lightning discharge.',
        activationGesture: 'POINT',
        cooldown: 1000,
        onActivate: (effects, audio) => {
          if (audio) audio.playZap();
          console.log('Lightning Bolt fired (VFX placeholder).');
        }
      }),
      LIGHTNING_SHIELD: new Superpower({
        name: 'LIGHTNING_SHIELD',
        description: 'Surrounds the user with a protective energy barrier.',
        activationGesture: 'OPEN_PALM',
        cooldown: 300,
        onActivate: (effects, audio) => {
          if (audio) audio.playCharge(0.25);
        },
        onUpdate: (effects, audio) => {
          // Placeholder charging sparks
          console.log('Lightning Shield active (VFX placeholder).');
        }
      }),
      POWER_BLAST: new Superpower({
        name: 'POWER_BLAST',
        description: 'Discharges a radial shockwave of pure force.',
        activationGesture: 'FIST',
        cooldown: 2000,
        onActivate: (effects, audio, palmContext) => {
          if (audio) audio.playZap();
          if (effects && palmContext) {
            effects.triggerBlast(palmContext.center, palmContext.radius, performance.now());
          }
          console.log('[Superpower Engine] Power Blast activated at centroid.');
        }
      }),
      THUNDER_MODE: new Superpower({
        name: 'THUNDER_MODE',
        description: 'Overcharges the energy capacitor to maximum power.',
        activationGesture: 'TWO_FINGER',
        cooldown: 8000,
        onActivate: (effects, audio, palmContext) => {
          if (audio) {
            audio.playZap();
          }
          if (effects) {
            effects.triggerThunderFlash(performance.now());
            if (palmContext) {
              for (let i = 0; i < 5; i++) {
                effects.spawnSparks(palmContext.center.x, palmContext.center.y, '#f5a623');
              }
            }
          }
          console.log('[Superpower Engine] THUNDER MODE activated.');
        },
        onUpdate: (effects, audio) => {
          // Continuous updates handled inside updateEngine
        }
      })
    };
  }

  /**
   * Core state machine update method coordinating active gestures.
   * @param {string} gesture Active gesture.
   * @param {boolean} gestureChanged Transition edge flag.
   * @param {number} timestamp Current performance timestamp in ms.
   * @param {Object} effects Effects renderer helper.
   * @param {Object} audio Audio manager helper.
   * @param {Object} [palmContext] Visual coordinates { center, radius }
   */
  updateEngine(gesture, gestureChanged, timestamp, effects, audio, palmContext) {
    // 1. Process System Mode State Transitions
    if (this.systemMode === 'DEPLETED') {
      const elapsed = timestamp - this.depletedStartTime;
      if (elapsed >= this.depletedDuration) {
        console.log('[Superpower Engine] Power restored. Returning to NORMAL MODE.');
        this.systemMode = 'NORMAL';
      } else {
        if (this.activePower) {
          this.activePower.cleanup(effects, audio);
          this.activePower = null;
        }
        this.chargeLevel = 0.0;
        this.prevGesture = gesture;
        this.decayCharge();
        return;
      }
    }

    if (this.systemMode === 'THUNDER') {
      const elapsed = timestamp - this.thunderStartTime;
      if (elapsed >= this.thunderDuration) {
        console.log('[Superpower Engine] Thunder Mode completed. Depleting power...');
        if (this.activePower) {
          this.activePower.cleanup(effects, audio);
          this.activePower = null;
        }
        this.systemMode = 'DEPLETED';
        this.depletedStartTime = timestamp;
        this.chargeLevel = 0.0;
        this.prevGesture = gesture;
        this.decayCharge();
        return;
      } else {
        // Overcharge power meter oscillation animation
        this.chargeLevel = 1.0 + Math.sin(timestamp / 35) * 0.07;
        
        // Continuous screen vibration shake (subtle)
        if (effects) {
          effects.shakeOffset.x = (Math.random() - 0.5) * 3.5;
          effects.shakeOffset.y = (Math.random() - 0.5) * 3.5;
        }
      }
    }

    // Auto-cleanup for one-shot POWER_BLAST after animation completes (1000ms)
    if (this.activePower && this.activePower.name === 'POWER_BLAST') {
      if (timestamp - this.activePower.lastActivatedTime >= 1000) {
        this.activePower.cleanup(effects, audio);
        this.activePower = null;
      }
    }

    // 2. Locate matching superpower option
    let targetPower = null;
    for (const key in this.powers) {
      const power = this.powers[key];
      if (power.activationGesture === gesture) {
        // Specific check for POWER_BLAST transition (requires transition from OPEN_PALM)
        if (power.name === 'POWER_BLAST') {
          if (gesture === 'FIST' && this.prevGesture === 'OPEN_PALM') {
            targetPower = power;
          }
        } else {
          targetPower = power;
        }
        break;
      }
    }

    // 3. Handle state transitions
    if (targetPower) {
      if (this.activePower !== targetPower) {
        // Switch power: clean up previous active power
        if (this.activePower) {
          this.activePower.cleanup(effects, audio);
        }
        
        // Attempt activation on target power
        const success = targetPower.activate(timestamp, effects, audio, palmContext);
        if (success) {
          this.activePower = targetPower;
          if (targetPower.name === 'THUNDER_MODE') {
            this.systemMode = 'THUNDER';
            this.thunderStartTime = timestamp;
          }
        } else {
          // Gated by cooldown
          this.activePower = null;
          this.decayCharge();
        }
      } else {
        // Continuous update on same power
        targetPower.update(effects, audio);
      }

      // 4. Coordinate dynamic capacitor charges
      if (this.activePower && this.systemMode !== 'THUNDER') {
        this.isCharging = true;
        if (this.activePower.name === 'LIGHTNING_SHIELD') {
          this.chargeLevel = Math.min(1.0, this.chargeLevel + 0.008);
        } else {
          // One-shot activations do not build continuous capacitor charges
          this.isCharging = false;
        }
      }
    } else {
      // Gesture is UNKNOWN or does not map to any active superpower trigger
      if (this.activePower && this.activePower.name !== 'POWER_BLAST' && this.activePower.name !== 'THUNDER_MODE') {
        this.activePower.cleanup(effects, audio);
        this.activePower = null;
      }
      this.decayCharge();
    }

    // 5. Update shield visual fade & rotation parameters
    const isShieldActive = (this.activePower && this.activePower.name === 'LIGHTNING_SHIELD');
    if (isShieldActive) {
      this.shieldOpacity = Math.min(1.0, this.shieldOpacity + 0.08);
      this.shieldAngle += 0.055;
    } else {
      this.shieldOpacity = Math.max(0.0, this.shieldOpacity - 0.08);
      this.shieldAngle += 0.035;
    }

    // Save previous gesture state for transition mappings
    this.prevGesture = gesture;
  }

  /**
   * Decays capacitor energy level when inactive.
   * @private
   */
  decayCharge() {
    this.isCharging = false;
    this.chargeLevel = Math.max(0.0, this.chargeLevel - 0.004);
  }

  /**
   * Returns the metadata of the currently selected power.
   * @returns {Object}
   */
  getSelectedPower() {
    return POWER_CATALOG[this.selectedPowerIndex] || POWER_CATALOG[0];
  }

  /**
   * Selects a power by index (0..3) or ID string.
   * @param {number|string} target
   * @returns {Object} Selected power metadata
   */
  selectPower(target) {
    if (typeof target === 'number') {
      this.selectedPowerIndex = Math.max(0, Math.min(POWER_CATALOG.length - 1, target));
    } else if (typeof target === 'string') {
      const idx = POWER_CATALOG.findIndex(p => p.id === target || p.key === target.toUpperCase());
      if (idx !== -1) {
        this.selectedPowerIndex = idx;
      }
    }
    return this.getSelectedPower();
  }

  /**
   * Cycles power selection forward or backward.
   * @param {number} direction +1 or -1
   * @returns {Object} Selected power metadata
   */
  cyclePower(direction = 1) {
    this.selectedPowerIndex = (this.selectedPowerIndex + direction + POWER_CATALOG.length) % POWER_CATALOG.length;
    return this.getSelectedPower();
  }

  /**
   * Returns current real-time status string for a given power ID.
   * @param {string} powerId
   * @param {number} timestamp
   * @returns {'READY'|'ACTIVE'|'COOLDOWN'|'DEPLETED'}
   */
  getPowerStatus(powerId, timestamp = performance.now()) {
    if (this.systemMode === 'DEPLETED') {
      return 'DEPLETED';
    }
    if (this.systemMode === 'THUNDER' && powerId === 'THUNDER_MODE') {
      return 'ACTIVE';
    }
    if (this.activePower && this.activePower.name === powerId) {
      return 'ACTIVE';
    }
    if (powerId === 'LIGHTNING_SHIELD' && this.shieldOpacity > 0.08) {
      return 'ACTIVE';
    }
    if (this.powers[powerId] && !this.powers[powerId].canActivate(timestamp)) {
      return 'COOLDOWN';
    }
    return 'READY';
  }
}
