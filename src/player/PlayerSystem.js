import * as THREE from 'three';

const GROUND_Y = 0.08;
const SPAWN_X = -13;
const SPAWN_Z = 18;
const WORLD_MIN_X = -27;
const WORLD_MAX_X = 27;
const WORLD_MIN_Z = -25;
const WORLD_MAX_Z = 25;
const MOVE_SPEED = 5.8;
const GUIDE_SPEED = 7.4;
const GUIDE_STOP_MARGIN = 0.18;
const GUIDE_TIMEOUT = 5;
const PLAYER_RADIUS = 0.55;
const MIN_INTERACTION_RADIUS = 2;
const YAW_RESPONSE = 18;
const CAMERA_RESPONSE = 7.5;
const CAMERA_OCCLUDED_RESPONSE = 22;
const CAMERA_OFFSET_X = 10.5;
const CAMERA_OFFSET_Y = 9.25;
const CAMERA_OFFSET_Z = 12.5;
const CAMERA_ISO_INV_LENGTH = 1 / Math.hypot(CAMERA_OFFSET_X, CAMERA_OFFSET_Z);
const CAMERA_ISO_X = CAMERA_OFFSET_X * CAMERA_ISO_INV_LENGTH;
const CAMERA_ISO_Z = CAMERA_OFFSET_Z * CAMERA_ISO_INV_LENGTH;
const CAMERA_LOOK_HEIGHT = 1.05;
const CAMERA_TARGET_HEIGHT = 1.55;
const CAMERA_TARGET_FRAME_RADIUS = 6.75;
const CAMERA_TARGET_LOOK_WEIGHT = 0.38;
const CAMERA_OCCLUDER_MIN_HEIGHT = 1.45;
const CAMERA_OCCLUDER_MIN_SPAN = 2.2;
const CAMERA_SURFACE_CLEARANCE = 0.42;
const CAMERA_MAX_PULL_IN = 0.9;
const CAMERA_FALLBACK_DISTANCE = 5.6;
const CAMERA_FALLBACK_HEIGHT = 7.2;
const CAMERA_FALLBACK_CLOSE = 0.32;
const CAMERA_FALLBACK_NEAR = 4.6;
const CAMERA_MARKER_LEAD = 0.45;
const SEGMENT_EPSILON = 1e-7;
const INV_SQRT_TWO = Math.SQRT1_2;

// A fixed isometric basis makes controls independent of tiny camera smoothing
// differences. W is screen-up; D is screen-right.
const FORWARD_X = -INV_SQRT_TWO;
const FORWARD_Z = -INV_SQRT_TWO;
const RIGHT_X = INV_SQRT_TWO;
const RIGHT_Z = -INV_SQRT_TWO;

function dampAngle(current, target, amount) {
  let difference = (target - current + Math.PI) % (Math.PI * 2) - Math.PI;
  if (difference < -Math.PI) difference += Math.PI * 2;
  return current + difference * amount;
}

function finiteComponent(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

/**
 * Deterministic, camera-relative movement and the sole contextual-action input
 * gate. Farm rules stay in FarmSystem; this class only decides whether the
 * player's body is close enough to request FarmSystem's exact active target.
 */
export class PlayerSystem {
  static id = 'player';
  static deps = ['farm', 'world'];

  async init(ctx) {
    this.ctx = ctx;
    this.farm = ctx.get('farm');
    this.world = ctx.get('world');
    this._defaultCameraNear = ctx.camera.near;

    this.position = new THREE.Vector3(SPAWN_X, GROUND_Y, SPAWN_Z);
    this.velocity = new THREE.Vector3();
    this.lastSafePosition = this.position.clone();
    this.targetPosition = new THREE.Vector3();
    this._desiredCamera = new THREE.Vector3();
    this._resolvedCamera = new THREE.Vector3();
    this._cameraLook = new THREE.Vector3();
    this._playerLook = new THREE.Vector3();
    this._targetLook = new THREE.Vector3();
    this._occluderBounds = new THREE.Box3();
    this._occluderSize = new THREE.Vector3();
    this._cameraOccluders = [];
    this._axis = { x: 0, y: 0 };

    this.yaw = Math.PI * 0.75;
    this.lastSafeYaw = this.yaw;
    this.moving = false;
    this.controlEnabled = true;
    this.controlsEnabled = true;
    this.activeTarget = null;
    this.canInteract = false;
    this.targetDistance = Infinity;
    this.distanceTravelled = 0;
    this.cameraOccluded = false;
    this._framingTarget = false;
    this.guidanceActive = false;
    this._guidedTargetId = null;
    this._guidedActionPending = false;
    this._guidedArrivalQueued = false;
    this._guidedActionCommittedThisFrame = false;
    this._guidedElapsed = 0;

    this.interaction = {
      id: null,
      verb: '',
      label: '',
      available: false,
      distance: Infinity,
    };
    this.state = {
      position: this.position,
      velocity: this.velocity,
      yaw: this.yaw,
      moving: false,
      controlEnabled: true,
      activeTargetId: null,
      canInteract: false,
      targetDistance: Infinity,
      cameraOccluded: false,
      guidanceActive: false,
      interaction: this.interaction,
    };
    this.publicState = this.state;
    this.public = this.state;

    this._focusId = null;
    this._focusAvailable = false;
    this._offSuccess = ctx.events.on('interaction:success', () => this._markSafePoint());
    this._offRestart = ctx.events.on('day:restart', () => {
      this.teleport([SPAWN_X, GROUND_Y, SPAWN_Z], [0, Math.PI * 0.75, 0]);
      this._syncTarget(true);
    });
    this._buildCameraOccluders();
    this._syncTarget(false);
    // UI initializes after PlayerSystem; force the first live frame to publish
    // the far "Follow marker" affordance instead of waiting for range to flip.
    this._focusId = null;
    this._focusAvailable = null;
    this._snapCamera();
  }

  getPublicState() {
    return this.state;
  }

  getPosition(out) {
    if (out?.copy) return out.copy(this.position);
    return this.position;
  }

  setControlEnabled(enabled) {
    const value = !!enabled;
    this.controlEnabled = value;
    this.controlsEnabled = value;
    this.state.controlEnabled = value;
    if (!value) {
      this._stopGuidance();
      this.moving = false;
      this.velocity.set(0, 0, 0);
      this.state.moving = false;
    }
    return this;
  }

  /** Used by captures and recovery tooling. The avatar remains grounded. */
  teleport(position, rotation = null) {
    if (!position) return this;
    const x = Array.isArray(position) ? position[0] : position.x;
    const z = Array.isArray(position) ? position[2] : position.z;
    this.position.set(
      THREE.MathUtils.clamp(finiteComponent(x, this.position.x), WORLD_MIN_X + PLAYER_RADIUS, WORLD_MAX_X - PLAYER_RADIUS),
      GROUND_Y,
      THREE.MathUtils.clamp(finiteComponent(z, this.position.z), WORLD_MIN_Z + PLAYER_RADIUS, WORLD_MAX_Z - PLAYER_RADIUS),
    );
    const rotationY = Array.isArray(rotation) ? rotation[1] : rotation?.y;
    if (Number.isFinite(rotationY)) this.yaw = rotationY;
    this.velocity.set(0, 0, 0);
    this.moving = false;
    this._stopGuidance();
    this._markSafePoint();
    this._syncTarget(false);
    this._syncPublicState();
    if (!this.ctx.input?.frozen) this._snapCamera();
    return this;
  }

  recover() {
    this.position.copy(this.lastSafePosition);
    this.position.x = THREE.MathUtils.clamp(
      this.position.x,
      WORLD_MIN_X + PLAYER_RADIUS,
      WORLD_MAX_X - PLAYER_RADIUS,
    );
    this.position.z = THREE.MathUtils.clamp(
      this.position.z,
      WORLD_MIN_Z + PLAYER_RADIUS,
      WORLD_MAX_Z - PLAYER_RADIUS,
    );
    this.position.y = GROUND_Y;
    this.yaw = this.lastSafeYaw;
    this.velocity.set(0, 0, 0);
    this.moving = false;
    this._stopGuidance();
    this._syncTarget(true);
    this._syncPublicState();
    if (!this.ctx.input?.frozen) this._snapCamera();
    this.ctx.events.emit('player:recover', {
      position: { x: this.position.x, y: this.position.y, z: this.position.z },
    });
    return this;
  }

  fixedUpdate(h, ctx) {
    const input = ctx.input;
    if (!this.controlEnabled || !input) {
      this.velocity.set(0, 0, 0);
      this.moving = false;
      return;
    }

    input.axis2('left', 'right', 'back', 'forward', this._axis);
    let moveX = FORWARD_X * this._axis.y + RIGHT_X * this._axis.x;
    let moveZ = FORWARD_Z * this._axis.y + RIGHT_Z * this._axis.x;
    let speed = MOVE_SPEED;
    let lengthSquared = moveX * moveX + moveZ * moveZ;

    if (lengthSquared > 0) {
      // Manual intent always wins immediately. The basis matches the normal
      // isometric camera, and the obstruction fallback keeps that azimuth.
      this._stopGuidance();
    } else if (this.guidanceActive) {
      this._guidedElapsed += h;
      if (!this.activeTarget?.id || this.activeTarget.id !== this._guidedTargetId) {
        this._stopGuidance();
      } else {
        const dx = this.targetPosition.x - this.position.x;
        const dz = this.targetPosition.z - this.position.z;
        const distanceSquared = dx * dx + dz * dz;
        const radius = Math.max(MIN_INTERACTION_RADIUS, Number(this.activeTarget.radius) || 0);
        const stopDistance = Math.max(PLAYER_RADIUS, radius - GUIDE_STOP_MARGIN);
        const maxTravel = GUIDE_SPEED * h;
        if (this._guidedElapsed >= GUIDE_TIMEOUT) {
          // Collision-free authored terrain should never need this, but a
          // throttled tab or future obstruction cannot strand the one-press
          // transaction. Land deterministically on the target's stop radius.
          const distance = Math.sqrt(distanceSquared);
          if (distance > SEGMENT_EPSILON) {
            const scale = stopDistance / distance;
            this.position.set(
              this.targetPosition.x - dx * scale,
              GROUND_Y,
              this.targetPosition.z - dz * scale,
            );
          }
          this.velocity.set(0, 0, 0);
          this.moving = false;
          this._guidedArrivalQueued = true;
          lengthSquared = 0;
        } else if (distanceSquared <= stopDistance * stopDistance) {
          // fixedUpdate must not emit farm mutations. Queue the arrival for
          // update(), after final target/distance synchronization.
          this.velocity.set(0, 0, 0);
          this.moving = false;
          this._guidedArrivalQueued = true;
          lengthSquared = 0;
        } else {
          const distance = Math.sqrt(distanceSquared);
          const remaining = distance - stopDistance;
          const inverseDistance = 1 / distance;
          moveX = dx * inverseDistance;
          moveZ = dz * inverseDistance;
          lengthSquared = 1;
          speed = Math.min(GUIDE_SPEED, remaining / Math.max(h, SEGMENT_EPSILON));
          if (remaining <= maxTravel + SEGMENT_EPSILON) {
            // The capped step lands at the exact stop radius this tick. Farm
            // interaction is emitted from update(), after final distance sync.
            this._guidedArrivalQueued = true;
          }
        }
      }
    }

    if (lengthSquared <= 0) {
      this.velocity.set(0, 0, 0);
      this.moving = false;
      return;
    }
    if (lengthSquared > 1) {
      const inverseLength = 1 / Math.sqrt(lengthSquared);
      moveX *= inverseLength;
      moveZ *= inverseLength;
    }

    this.velocity.set(moveX * speed, 0, moveZ * speed);
    const previousX = this.position.x;
    const previousZ = this.position.z;
    this.position.x = THREE.MathUtils.clamp(
      previousX + this.velocity.x * h,
      WORLD_MIN_X + PLAYER_RADIUS,
      WORLD_MAX_X - PLAYER_RADIUS,
    );
    this.position.z = THREE.MathUtils.clamp(
      previousZ + this.velocity.z * h,
      WORLD_MIN_Z + PLAYER_RADIUS,
      WORLD_MAX_Z - PLAYER_RADIUS,
    );
    this.position.y = GROUND_Y;

    const actualX = this.position.x - previousX;
    const actualZ = this.position.z - previousZ;
    this.distanceTravelled += Math.sqrt(actualX * actualX + actualZ * actualZ);
    this.moving = actualX !== 0 || actualZ !== 0;
    if (!this.moving) this.velocity.set(0, 0, 0);

    const targetYaw = Math.atan2(moveX, moveZ);
    const yawAmount = 1 - Math.exp(-YAW_RESPONSE * h);
    this.yaw = dampAngle(this.yaw, targetYaw, yawAmount);
  }

  update(_dt, ctx) {
    this._syncTarget(true);

    if (!this.controlEnabled || !ctx.input) return;
    if (this.guidanceActive && this.activeTarget?.id === this._guidedTargetId) {
      // Free-running rAF can legitimately deliver no fixed step on a very fast
      // frame. Arrival is therefore also checked here so one-press guidance
      // cannot wait behind the fixed-step accumulator at a station boundary.
      const radius = Math.max(MIN_INTERACTION_RADIUS, Number(this.activeTarget.radius) || 0);
      if (this.targetDistance <= Math.max(PLAYER_RADIUS, radius - GUIDE_STOP_MARGIN) + 0.03) {
        this._guidedArrivalQueued = true;
      }
    }
    if (this._guidedArrivalQueued) {
      this._guidedArrivalQueued = false;
      this._completeGuidedArrival();
    }
    this._syncPublicState();
    const usePressed = ctx.input.pressed('use') || ctx.input.pressed('primary');
    // A guided arrival may synchronously advance Farm to its next subtarget.
    // Do not reuse the same physical E edge for that newly-active target.
    if (usePressed && !this._guidedActionCommittedThisFrame) {
      if (this.canInteract) {
        this._stopGuidance();
        ctx.events.emit('interaction:attempt', { id: this.activeTarget.id });
      } else {
        const guided = this.guidanceActive || this._startGuidance();
        // Preserve the canonical physical-attempt event for feedback, audio,
        // and the smoke contract. Farm receives null and cannot mutate while
        // guidance begins toward the exact active target.
        ctx.events.emit('interaction:attempt', { id: null, guided });
      }
    }
    this._guidedActionCommittedThisFrame = false;
    if (ctx.input.pressed('reload')) this.recover();
  }

  lateUpdate(dt, ctx) {
    // Locked capture shots own the camera explicitly.
    if (ctx.input?.frozen) return;
    const wasOccluded = this.cameraOccluded;
    this._resolveCameraPosition();
    this._syncCameraNear();
    if (this.cameraOccluded && !wasOccluded) {
      // Do not spend several rendered frames travelling through the roof that
      // triggered the fallback. Recovery to the wide boom remains smoothed.
      ctx.camera.position.copy(this._resolvedCamera);
    } else {
      const response = this.cameraOccluded ? CAMERA_OCCLUDED_RESPONSE : CAMERA_RESPONSE;
      const amount = 1 - Math.exp(-response * Math.max(0, dt));
      ctx.camera.position.lerp(this._resolvedCamera, amount);
    }
    ctx.camera.lookAt(this._cameraLook);
  }

  _buildCameraOccluders() {
    const root = this.world?.root;
    if (!root?.traverse) return;
    root.updateWorldMatrix(true, true);
    root.traverse((object) => {
      if (!object.isMesh || object.isInstancedMesh || !object.geometry) return;
      const materials = Array.isArray(object.material) ? object.material : null;
      if (materials) {
        let allTransparent = true;
        for (let i = 0; i < materials.length; i += 1) {
          const material = materials[i];
          if (material && !material.transparent && material.opacity >= 0.95) {
            allTransparent = false;
            break;
          }
        }
        if (allTransparent) return;
      } else if (object.material?.transparent || (object.material?.opacity ?? 1) < 0.95) {
        return;
      }

      if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
      const localBounds = object.geometry.boundingBox;
      if (!localBounds) return;
      this._occluderBounds.copy(localBounds).applyMatrix4(object.matrixWorld);
      this._occluderBounds.getSize(this._occluderSize);
      if (
        this._occluderSize.y < CAMERA_OCCLUDER_MIN_HEIGHT ||
        Math.max(this._occluderSize.x, this._occluderSize.z) < CAMERA_OCCLUDER_MIN_SPAN ||
        this._occluderBounds.max.y < CAMERA_LOOK_HEIGHT
      ) {
        return;
      }
      this._cameraOccluders.push({
        minX: this._occluderBounds.min.x,
        minY: this._occluderBounds.min.y,
        minZ: this._occluderBounds.min.z,
        maxX: this._occluderBounds.max.x,
        maxY: this._occluderBounds.max.y,
        maxZ: this._occluderBounds.max.z,
      });
    });
  }

  _resolveCameraPosition() {
    this._playerLook.set(this.position.x, this.position.y + CAMERA_LOOK_HEIGHT, this.position.z);
    this._cameraLook.copy(this._playerLook);
    this._framingTarget = Boolean(
      this.activeTarget?.id &&
      Number.isFinite(this.targetDistance) &&
      this.targetDistance <= CAMERA_TARGET_FRAME_RADIUS
    );
    if (this._framingTarget) {
      this._targetLook.set(
        this.targetPosition.x,
        this.targetPosition.y + CAMERA_TARGET_HEIGHT,
        this.targetPosition.z,
      );
      this._cameraLook.lerp(this._targetLook, CAMERA_TARGET_LOOK_WEIGHT);
    }

    this._desiredCamera.set(
      this._cameraLook.x + CAMERA_OFFSET_X,
      this._cameraLook.y + CAMERA_OFFSET_Y,
      this._cameraLook.z + CAMERA_OFFSET_Z,
    );
    this._resolvedCamera.copy(this._desiredCamera);

    let entry = this._deepestOccluderEntry(this._desiredCamera, this._cameraLook);
    if (this._framingTarget) {
      entry = Math.max(
        entry,
        this._deepestOccluderEntry(this._desiredCamera, this._playerLook),
        this._deepestOccluderEntry(this._desiredCamera, this._targetLook),
      );
    }

    this.cameraOccluded = entry >= 0;
    if (!this.cameraOccluded) {
      this._positionWorldMarker(this.targetPosition.x, this.targetPosition.z);
      return;
    }

    const boomLength = this._desiredCamera.distanceTo(this._cameraLook);
    const pull = Math.min(
      CAMERA_MAX_PULL_IN,
      entry + CAMERA_SURFACE_CLEARANCE / Math.max(boomLength, CAMERA_SURFACE_CLEARANCE),
    );
    this._resolvedCamera.lerp(this._cameraLook, pull);

    // Any blocked live shot gets the exterior camera. In particular, the
    // shrine-to-bed hand-off starts just beyond the normal framing radius; a
    // pull-in alone would otherwise leave the house roof between the player
    // and camera until they walked closer.
    if (this.activeTarget?.id) this._placeExteriorFallback();
    else this._positionWorldMarker(this.targetPosition.x, this.targetPosition.z);
  }

  _placeExteriorFallback() {
    let outwardX = this.position.x - this.targetPosition.x;
    let outwardZ = this.position.z - this.targetPosition.z;
    const outwardLength = Math.sqrt(outwardX * outwardX + outwardZ * outwardZ);
    if (outwardLength > SEGMENT_EPSILON) {
      outwardX /= outwardLength;
      outwardZ /= outwardLength;
    } else {
      outwardX = INV_SQRT_TWO;
      outwardZ = INV_SQRT_TWO;
    }

    if (this._framingTarget) {
      const markerDistance = Math.min(CAMERA_MARKER_LEAD, outwardLength * 0.35);
      const markerX = this.position.x - outwardX * markerDistance;
      const markerZ = this.position.z - outwardZ * markerDistance;
      this._positionWorldMarker(markerX, markerZ);
      this._targetLook.set(markerX, this.position.y + CAMERA_TARGET_HEIGHT, markerZ);
      this._cameraLook.copy(this._playerLook).lerp(this._targetLook, CAMERA_TARGET_LOOK_WEIGHT);
    } else {
      this._positionWorldMarker(this.targetPosition.x, this.targetPosition.z);
      this._targetLook.copy(this._playerLook);
      this._cameraLook.copy(this._playerLook);
    }

    // Both fallback distances retain the normal camera's horizontal azimuth,
    // so W stays screen-up and D stays screen-right beside every large roof.
    this._resolvedCamera.set(
      this.position.x + CAMERA_ISO_X * CAMERA_FALLBACK_DISTANCE,
      this.position.y + CAMERA_FALLBACK_HEIGHT,
      this.position.z + CAMERA_ISO_Z * CAMERA_FALLBACK_DISTANCE,
    );
    if (
      this._viewBlocked(this._resolvedCamera, this._playerLook) ||
      this._viewBlocked(this._resolvedCamera, this._targetLook)
    ) {
      this._resolvedCamera.set(
        this.position.x + CAMERA_ISO_X * CAMERA_FALLBACK_CLOSE,
        this.position.y + CAMERA_FALLBACK_HEIGHT,
        this.position.z + CAMERA_ISO_Z * CAMERA_FALLBACK_CLOSE,
      );
    }
  }

  _positionWorldMarker(x, z) {
    const marker = this.world?.marker;
    if (!marker?.position || !this.activeTarget?.id) return;
    marker.position.x = x;
    marker.position.z = z;
  }

  _viewBlocked(from, to) {
    return this._deepestOccluderEntry(
      from,
      to,
      this.cameraOccluded ? CAMERA_FALLBACK_NEAR : 0,
    ) >= 0;
  }

  _deepestOccluderEntry(from, to, nearClip = 0) {
    let deepest = -1;
    const segmentLength = nearClip > 0 ? from.distanceTo(to) : 0;
    for (let i = 0; i < this._cameraOccluders.length; i += 1) {
      const box = this._cameraOccluders[i];
      // Cameras inside a one-sided mesh see through its back faces. This is the
      // deliberate close fallback for roots placed inside roofs/buildings.
      if (
        from.x >= box.minX && from.x <= box.maxX &&
        from.y >= box.minY && from.y <= box.maxY &&
        from.z >= box.minZ && from.z <= box.maxZ
      ) {
        continue;
      }
      const entry = this._segmentBoxEntry(from, to, box);
      if (
        entry > deepest &&
        entry < 1 - SEGMENT_EPSILON &&
        // The fallback's near plane cuts away a roof or wall encountered
        // before it, while the player and marker remain beyond that plane.
        !(nearClip > 0 && entry * segmentLength <= nearClip)
      ) deepest = entry;
    }
    return deepest;
  }

  _segmentBoxEntry(from, to, box) {
    let near = 0;
    let far = 1;

    let delta = to.x - from.x;
    if (Math.abs(delta) < SEGMENT_EPSILON) {
      if (from.x < box.minX || from.x > box.maxX) return -1;
    } else {
      let a = (box.minX - from.x) / delta;
      let b = (box.maxX - from.x) / delta;
      if (a > b) { const swap = a; a = b; b = swap; }
      near = Math.max(near, a);
      far = Math.min(far, b);
      if (near > far) return -1;
    }

    delta = to.y - from.y;
    if (Math.abs(delta) < SEGMENT_EPSILON) {
      if (from.y < box.minY || from.y > box.maxY) return -1;
    } else {
      let a = (box.minY - from.y) / delta;
      let b = (box.maxY - from.y) / delta;
      if (a > b) { const swap = a; a = b; b = swap; }
      near = Math.max(near, a);
      far = Math.min(far, b);
      if (near > far) return -1;
    }

    delta = to.z - from.z;
    if (Math.abs(delta) < SEGMENT_EPSILON) {
      if (from.z < box.minZ || from.z > box.maxZ) return -1;
    } else {
      let a = (box.minZ - from.z) / delta;
      let b = (box.maxZ - from.z) / delta;
      if (a > b) { const swap = a; a = b; b = swap; }
      near = Math.max(near, a);
      far = Math.min(far, b);
      if (near > far) return -1;
    }

    return far >= 0 && near <= 1 ? Math.max(0, near) : -1;
  }

  _syncTarget(emitFocus) {
    const target = this.farm.getActiveTarget?.() ?? this.farm.activeTarget ?? null;
    this.activeTarget = target;
    let available = false;
    let distance = Infinity;

    if (target?.id && this.world.getInteractablePosition?.(target.id, this.targetPosition)) {
      const dx = this.targetPosition.x - this.position.x;
      const dz = this.targetPosition.z - this.position.z;
      distance = Math.sqrt(dx * dx + dz * dz);
      const radius = Math.max(MIN_INTERACTION_RADIUS, Number(target.radius) || 0);
      available = distance <= radius;
    }

    this.canInteract = available;
    this.targetDistance = distance;
    this.interaction.id = target?.id ?? null;
    this.interaction.verb = target?.verb ?? '';
    this.interaction.label = target?.label ?? '';
    this.interaction.available = available;
    this.interaction.distance = distance;

    const id = target?.id ?? null;
    if (emitFocus && (id !== this._focusId || available !== this._focusAvailable)) {
      this.ctx.events.emit('interaction:focus', {
        id,
        verb: available ? this.interaction.verb : 'Follow & work',
        // UI renders `label` first, so keep it a literal action rather than a
        // noun such as "stone well". The noun remains available separately.
        label: available ? this.interaction.verb : 'Follow & work',
        targetLabel: this.interaction.label,
        // The prompt is actionable both near (work) and far (guide). Preserve
        // physical range separately so no consumer can mistake it for reach.
        available: Boolean(id),
        inRange: available,
        distance,
      });
    }
    this._focusId = id;
    this._focusAvailable = available;
  }

  _syncPublicState() {
    this.state.yaw = this.yaw;
    this.state.moving = this.moving;
    this.state.controlEnabled = this.controlEnabled;
    this.state.activeTargetId = this.activeTarget?.id ?? null;
    this.state.canInteract = this.canInteract;
    this.state.targetDistance = this.targetDistance;
    this.state.cameraOccluded = this.cameraOccluded;
    this.state.guidanceActive = this.guidanceActive;
  }

  _startGuidance() {
    const id = this.activeTarget?.id;
    if (!id || !Number.isFinite(this.targetDistance)) return false;
    if (this.guidanceActive && this._guidedTargetId === id) return false;
    this.guidanceActive = true;
    this._guidedTargetId = id;
    this._guidedActionPending = true;
    this._guidedArrivalQueued = false;
    this._guidedElapsed = 0;
    this.ctx.events.emit('player:guide', {
      id,
      active: true,
      distance: this.targetDistance,
    });
    this.ctx.events.emit('interaction:focus', {
      id,
      verb: 'Following marker…',
      label: 'Following marker…',
      targetLabel: this.interaction.label,
      available: true,
      distance: this.targetDistance,
      guidance: true,
    });
    return true;
  }

  _completeGuidedArrival() {
    const id = this._guidedTargetId;
    const shouldAct = Boolean(
      this.guidanceActive &&
      this._guidedActionPending &&
      id &&
      this.activeTarget?.id === id &&
      this.canInteract
    );
    this._stopGuidance();
    if (shouldAct) {
      this._guidedActionCommittedThisFrame = true;
      this.ctx.events.emit('interaction:attempt', { id, guided: true });
    }
  }

  _stopGuidance() {
    if (!this.guidanceActive) {
      this._guidedTargetId = null;
      this._guidedActionPending = false;
      this._guidedArrivalQueued = false;
      this._guidedElapsed = 0;
      return;
    }
    const id = this._guidedTargetId;
    this.guidanceActive = false;
    this._guidedTargetId = null;
    this._guidedActionPending = false;
    this._guidedArrivalQueued = false;
    this._guidedElapsed = 0;
    // Force the next target sync to restore either "Follow marker" after a
    // manual cancel or the canonical work verb after an arrival.
    this._focusId = null;
    this.ctx?.events?.emit?.('player:guide', { id, active: false, distance: this.targetDistance });
  }

  _markSafePoint() {
    this.lastSafePosition.copy(this.position);
    this.lastSafePosition.y = GROUND_Y;
    this.lastSafeYaw = this.yaw;
  }

  _snapCamera() {
    const camera = this.ctx.camera;
    this._resolveCameraPosition();
    this._syncCameraNear();
    camera.position.copy(this._resolvedCamera);
    camera.lookAt(this._cameraLook);
    camera.updateMatrixWorld(true);
  }

  _syncCameraNear() {
    const camera = this.ctx.camera;
    const nextNear = this.cameraOccluded ? CAMERA_FALLBACK_NEAR : this._defaultCameraNear;
    if (Math.abs(camera.near - nextNear) <= SEGMENT_EPSILON) return;
    camera.near = nextNear;
    camera.updateProjectionMatrix();
  }

  dispose() {
    if (this.ctx?.camera && Number.isFinite(this._defaultCameraNear)) {
      this.ctx.camera.near = this._defaultCameraNear;
      this.ctx.camera.updateProjectionMatrix();
    }
    this._offSuccess?.();
    this._offRestart?.();
    this._offSuccess = null;
    this._offRestart = null;
    this.activeTarget = null;
    this.ctx = null;
    this.farm = null;
    this.world = null;
  }
}
