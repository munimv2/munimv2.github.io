// feeder.js - demand-responsive transit with one change to or from the bus, for Kaerimichi's service-gap map.
// A stop that can't make the round trip by bus, or by one demand-responsive ride each way, may still make it with a
// booked ride to a bus stop and a direct bus on from there (or the bus one way and a booked ride the other way).
// Same rules as the 'mixed' and 'feeder' layers of tools/flex/flex_change.mjs, so the app and the published counts agree.
// No imports: the caller passes in what gtfs.js computes (flexDay, flex.locations, flexCover, hubJourneys).
// MV2 of Munim, Inc. - Apache-2.0 license. Made with AI agents working in MV2's name.

// A window missing from the data is open all day.
const OPEN_START = -1e9, OPEN_END = 1e9;
const EMPTY = new Set();

// Every one-ride piece of the day's demand-responsive trips (flexDay's list): pickup at call i, drop-off at call j >= i,
// the places each end covers (flexCover's map) and the window [start, end]. Pieces too short for a ride of `ride`
// seconds are left out.
export function rideSegments(trips, locations, cover, ride = 0) {
  const out = [];
  for (const t of trips) {
    const c = t.calls;
    for (let i = 0; i < c.length; i++) {
      if (!c[i].pickup || !locations.has(c[i].loc)) continue;
      for (let j = i; j < c.length; j++) {
        if (!c[j].drop || !locations.has(c[j].loc)) continue;
        const start = c[i].start === null ? OPEN_START : c[i].start;
        const end = c[j].end === null ? OPEN_END : c[j].end;
        if (start + ride > end) continue;
        out.push({ trip: t, start, end, from: cover.get(c[i].loc) || EMPTY, to: cover.get(c[j].loc) || EMPTY });
      }
    }
  }
  return out;
}

// Per place: the earliest arrival at the hub (there) and the latest departure from it back (back), each null or
// {t, mode, trip, via, bus}. mode is 'bus' (hj.to / hj.from, with the transfers hj was built with), 'flex' (one
// demand-responsive ride) or 'feeder' (a ride to bus stop `via`, then the direct bus `bus`; back: the bus to `via`,
// then a ride home). On a tie the simpler mode is kept. Rides take `ride` seconds; each change takes minConn.
export function feederTimes(hj, segs, hub, count, minConn = 300, ride = 0) {
  const there = new Array(count).fill(null);
  const back = new Array(count).fill(null);
  const earlier = (p, x) => { if (p !== hub && (!there[p] || x.t < there[p].t)) there[p] = x; };
  const later = (p, x) => { if (p !== hub && (!back[p] || x.t > back[p].t)) back[p] = x; };
  for (let p = 0; p < count; p++) {
    for (const j of hj.to[p]) earlier(p, { t: j.arr, mode: 'bus', trip: j.trip, via: null, bus: j });
    for (const j of hj.from[p]) later(p, { t: j.dep, mode: 'bus', trip: j.trip, via: null, bus: j });
  }
  for (const s of segs) {
    if (s.to.has(hub)) for (const p of s.from) earlier(p, { t: s.start + ride, mode: 'flex', trip: s.trip, via: null, bus: null });
    if (s.from.has(hub)) for (const p of s.to) later(p, { t: s.end - ride, mode: 'flex', trip: s.trip, via: null, bus: null });
  }
  for (const s of segs) {
    let best = null;
    for (const q of s.to) {
      for (const j of hj.toDirect[q]) {
        if (j.dep >= s.start + ride + minConn && (!best || j.arr < best.bus.arr)) best = { via: q, bus: j };
      }
    }
    if (best) for (const p of s.from) earlier(p, { t: best.bus.arr, mode: 'feeder', trip: s.trip, via: best.via, bus: best.bus });
    best = null;
    for (const q of s.from) {
      for (const j of hj.fromDirect[q]) {
        if (Math.max(j.arr + minConn, s.start) + ride <= s.end && (!best || j.dep > best.bus.dep)) best = { via: q, bus: j };
      }
    }
    if (best) for (const p of s.to) later(p, { t: best.bus.dep, mode: 'feeder', trip: s.trip, via: best.via, bus: best.bus });
  }
  return { there, back };
}

// Place p's round trip over all three modes, or null: the way there and the way back are separate, so it works when
// the latest departure back is at least minStay after the earliest arrival.
export function feederTrip(times, p, minStay = 0) {
  const a = times.there[p], b = times.back[p];
  if (!a || !b || b.t - a.t < minStay) return null;
  return { there: a, back: b, stay: b.t - a.t };
}

// Does round trip r use both a bus and a demand-responsive ride? Only then is it the app's 'flexbus' verdict
// (buses both ways is a bus round trip; a ride both ways is the 'flex' one).
export function busAndRide(r) {
  const modes = [r.there.mode, r.back.mode];
  return modes.some(m => m !== 'flex') && modes.some(m => m !== 'bus');
}
