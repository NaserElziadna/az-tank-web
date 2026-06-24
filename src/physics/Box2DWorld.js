import Box2D from 'box2dweb';
import { C } from '../constants/GameConstants.js';

// Pull the verbose Box2dWeb namespace into short locals.
const b2Vec2 = Box2D.Common.Math.b2Vec2;
const b2World = Box2D.Dynamics.b2World;
const b2BodyDef = Box2D.Dynamics.b2BodyDef;
const b2Body = Box2D.Dynamics.b2Body;
const b2FixtureDef = Box2D.Dynamics.b2FixtureDef;
const b2PolygonShape = Box2D.Collision.Shapes.b2PolygonShape;
const b2CircleShape = Box2D.Collision.Shapes.b2CircleShape;
const b2ContactListener = Box2D.Dynamics.b2ContactListener;
const b2AABB = Box2D.Collision.b2AABB;
const b2WorldManifold = Box2D.Collision.b2WorldManifold;

/** Collision categories — identical bitmask to the original game. */
export const CAT = Object.freeze({
  TANK: 0x0001,
  MAZE: 0x0002,
  PROJECTILE: 0x0004,
  TRAP: 0x0008,
  COLLECTIBLE: 0x0010,
  SHIELD: 0x0020,
  ZONE: 0x0040,
});

/**
 * The real Box2D (box2dweb 2.1.0-b) physics world — the same engine and version
 * the original game uses. Wraps body creation (tanks, projectiles, mines,
 * collectibles, walls) with the original's exact fixture parameters and
 * collision filters, and surfaces per-step contact events (kills, bounces,
 * pickups) gathered by a contact listener.
 *
 * All units are metres; rendering scales by PIXELS_PER_METER.
 */
export class Box2DWorld {
  constructor() {
    this.world = new b2World(new b2Vec2(0, 0), true); // no gravity, allow sleep
    /** @type {Array<{a:any, b:any, kind:string}>} contacts this step */
    this.contacts = [];
    /** Projectiles that touched a wall/shield this step (id set) for bounce SFX. */
    this.bounced = new Set();
    /** Per-tank wall-contact normal (slot -> unit {x,y} pointing out of the wall). */
    this.tankWallNormal = new Map();
    this._worldManifold = new b2WorldManifold();
    this._installContactListener();
  }

  _installContactListener() {
    const listener = new b2ContactListener();
    const classify = (ud) => (ud && ud.gameObject ? ud.gameObject : null);
    listener.BeginContact = (contact) => {
      const a = classify(contact.GetFixtureA().GetUserData());
      const b = classify(contact.GetFixtureB().GetUserData());
      if (!a || !b) return;
      this.contacts.push({ a, b });
      // Track projectile/wall + projectile/shield bounces for "deadly to owner".
      this._markBounce(a, b);
      this._markBounce(b, a);
    };
    // Capture tank↔wall contact normals so the controller can slide along walls
    // instead of dead-stopping (PreSolve has a resolved world manifold).
    listener.PreSolve = (contact) => {
      const a = classify(contact.GetFixtureA().GetUserData());
      const b = classify(contact.GetFixtureB().GetUserData());
      if (!a || !b) return;
      let tank = null;
      let tankIsA = false;
      if (a.kind === 'tank' && b.kind === 'wall') {
        tank = a;
        tankIsA = true;
      } else if (b.kind === 'tank' && a.kind === 'wall') {
        tank = b;
        tankIsA = false;
      } else return;
      contact.GetWorldManifold(this._worldManifold);
      let nx = this._worldManifold.m_normal.x;
      let ny = this._worldManifold.m_normal.y;
      // m_normal points from fixtureA to fixtureB. Orient it to point OUT of the
      // wall (toward the tank / open space).
      if (tankIsA) {
        nx = -nx;
        ny = -ny;
      }
      const len = Math.hypot(nx, ny) || 1;
      this.tankWallNormal.set(tank.slot, { x: nx / len, y: ny / len });
    };
    this.world.SetContactListener(listener);
  }

  _markBounce(obj, other) {
    if (obj.kind === 'projectile' && (other.kind === 'wall' || other.kind === 'shield')) {
      this.bounced.add(obj.id);
    }
  }

  /** Advance the simulation one fixed step and collect contacts. */
  step(dt) {
    this.contacts.length = 0;
    this.bounced.clear();
    this.tankWallNormal.clear();
    this.world.Step(dt, 10, 10); // velocity / position iterations (original uses 10/10)
    this.world.ClearForces();
  }

  // ── body factories ─────────────────────────────────────────────────────
  /**
   * Build static wall bodies from merged maze rectangles.
   * @param {{minX:number,minY:number,maxX:number,maxY:number}[]} walls
   * @param {object} mazeGameObject userData back-reference
   */
  createWalls(walls, mazeGameObject) {
    for (const w of walls) {
      const hw = (w.maxX - w.minX) / 2;
      const hh = (w.maxY - w.minY) / 2;
      const cx = (w.minX + w.maxX) / 2;
      const cy = (w.minY + w.maxY) / 2;
      const bd = new b2BodyDef();
      bd.type = b2Body.b2_staticBody;
      bd.position.Set(cx, cy);
      const body = this.world.CreateBody(bd);
      const fd = new b2FixtureDef();
      fd.density = 0;
      fd.friction = 0.05;
      fd.restitution = 0; // projectile restitution comes from the projectile
      fd.shape = new b2PolygonShape();
      fd.shape.SetAsBox(hw, hh);
      fd.filter.categoryBits = CAT.MAZE;
      fd.filter.maskBits = CAT.TANK | CAT.PROJECTILE | CAT.TRAP;
      fd.userData = { gameObject: { kind: 'wall', maze: mazeGameObject } };
      body.CreateFixture(fd);
    }
  }

  /** Dynamic 3×4 m tank box (the original's exact fixture params). */
  createTank(gameObject, x, y, rotation) {
    const bd = new b2BodyDef();
    bd.type = b2Body.b2_dynamicBody;
    bd.position.Set(x, y);
    bd.angle = rotation;
    bd.fixedRotation = false;
    bd.linearDamping = 0;
    bd.allowSleep = false;
    const body = this.world.CreateBody(bd);
    const fd = new b2FixtureDef();
    fd.density = 1.0;
    fd.friction = 0.25;
    fd.restitution = 0;
    fd.shape = new b2PolygonShape();
    fd.shape.SetAsBox(C.TANK.WIDTH / 2, C.TANK.HEIGHT / 2);
    fd.filter.categoryBits = CAT.TANK;
    fd.filter.maskBits = CAT.TANK | CAT.MAZE | CAT.PROJECTILE | CAT.TRAP | CAT.COLLECTIBLE | CAT.SHIELD | CAT.ZONE;
    fd.userData = { gameObject };
    body.CreateFixture(fd);
    return body;
  }

  /** Dynamic circle projectile: frictionless, perfectly elastic, CCD bullet. */
  createProjectile(gameObject, x, y, vx, vy, radius) {
    const bd = new b2BodyDef();
    bd.type = b2Body.b2_dynamicBody;
    bd.position.Set(x, y);
    bd.fixedRotation = true;
    bd.linearDamping = 0;
    bd.bullet = true; // continuous collision detection
    const body = this.world.CreateBody(bd);
    const fd = new b2FixtureDef();
    fd.density = 0.01;
    fd.friction = 0;
    fd.restitution = 1.0;
    fd.shape = new b2CircleShape(radius);
    fd.filter.categoryBits = CAT.PROJECTILE;
    fd.filter.maskBits = CAT.TANK | CAT.MAZE | CAT.SHIELD | CAT.ZONE;
    fd.userData = { gameObject };
    body.CreateFixture(fd);
    body.SetLinearVelocity(new b2Vec2(vx, vy));
    return body;
  }

  /** Dynamic circle mine/trap body. Damped + low restitution so a dropped mine
   *  slides out behind the tank and quickly settles (not a perpetual bouncing ball). */
  createTrap(gameObject, x, y, radius, vx, vy) {
    const bd = new b2BodyDef();
    bd.type = b2Body.b2_dynamicBody;
    bd.position.Set(x, y);
    bd.fixedRotation = true;
    bd.linearDamping = 6.0;
    bd.allowSleep = true;
    const body = this.world.CreateBody(bd);
    const fd = new b2FixtureDef();
    fd.density = 0.4;
    fd.friction = 0.6;
    fd.restitution = 0.1;
    fd.shape = new b2CircleShape(radius);
    fd.filter.categoryBits = CAT.TRAP;
    fd.filter.maskBits = CAT.TRAP | CAT.TANK | CAT.MAZE | CAT.ZONE;
    fd.userData = { gameObject };
    body.CreateFixture(fd);
    if (vx || vy) body.SetLinearVelocity(new b2Vec2(vx, vy));
    return body;
  }

  /** Static sensor collectible (crate/gold/diamond) — only collides with tanks. */
  createCollectible(gameObject, x, y, radius) {
    const bd = new b2BodyDef();
    bd.type = b2Body.b2_staticBody;
    bd.position.Set(x, y);
    const body = this.world.CreateBody(bd);
    const fd = new b2FixtureDef();
    fd.density = 0;
    fd.isSensor = true;
    fd.shape = new b2CircleShape(radius);
    fd.filter.categoryBits = CAT.COLLECTIBLE;
    fd.filter.maskBits = CAT.TANK;
    fd.userData = { gameObject };
    body.CreateFixture(fd);
    return body;
  }

  destroyBody(body) {
    if (body) this.world.DestroyBody(body);
  }

  /** Raycast helper returning the nearest fixture matching `mask`. */
  rayCast(x1, y1, x2, y2, mask = CAT.MAZE | CAT.TANK) {
    let best = null;
    this.world.RayCast(
      (fixture, point, normal, fraction) => {
        if ((fixture.GetFilterData().categoryBits & mask) === 0) return -1;
        best = { point: { x: point.x, y: point.y }, normal: { x: normal.x, y: normal.y }, fraction, fixture };
        return fraction;
      },
      new b2Vec2(x1, y1),
      new b2Vec2(x2, y2),
    );
    return best;
  }

  static vec(x, y) {
    return new b2Vec2(x, y);
  }
}

export { b2Vec2 };
