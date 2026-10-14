# Magical gameplay contracts (save version 5)

The browser loop is `garden → brew → creature trial → player ID → negotiate →
deliver → delayed return`. All gameplay reads the same particle-derived sample.
No shop view reports physical composition or silently writes measured enchantment
values into the player’s ID.

- **World:** IDs 1–11 retain their recipe identities. IDs 12–14 add Phoenix Sap,
  Moon Dew and Dream Nectar. Only plain water is the neutral solvent. There are
  eleven starter ingredients and three guild unlocks. Old pinned ingredients,
  balances and active phases survive migration; missing liquids get garden beds,
  without free inventory grants.
- **Garden:** finite beds hold 10–20 measures, one basket picks at most 10 and
  timing retains 40–100% of the picked crop. Harvesting costs 12 stamina, tending
  6 stamina plus 5 ml water, and stamina regenerates one point per seven seconds.
  Minimum ripe stock is five; beds recover over 8–20 minutes and cap their stock.
  Tending doubles growth for two minutes. Jars cap garden collection at 72
  measures (96 with the garden toolkit). Toolkit harvests cost nine stamina.
  Water and the isolated sandbox remain renewable. Village parcels cap at 20,
  cost five times reagent value plus eight coins and have two-minute cooldowns.
- **Magic:** `arcaneThreshold` uses the material, particle, sampling and
  conservative contact-transport paths. `heatSolubility` widens the affinity
  envelope in warm contacts; it is opted in by the game.
  `stepArcana` uses local temperature independently of phase changes. Crossing
  the mapped threshold by .015 physical temperature units for .4 seconds
  activates magic independently of whether the parcel is solid powder,
  liquid, or gas. Rune thresholds are *signed* relative to room temperature,
  with physical trigger T = 0.33 + rune/40: cooling a -800°A rune to 13°A
  or heating a +1100°A rune to 60.5°A is possible with the current tools.
  A blended rune uses original portion weights:
  sum(threshold_i * portion_i) / sum(portion_i);
  -1000°A and +800°A in a 1:2 ratio yield +200°A, and negative/zero
  results remain valid. Its awakened channels
  reflect the same input shares (Strength 33%, Venom 66% for 1:2); unrelated
  magic becomes zero. A solitary ingredient awakens its strongest channel.
  Each particle glows using the actual homogeneous mixture's eight magic
  channels and its strength (including gas and powder). Base ingredient
  enchantments are weak (max 12%) until a genuine threshold transition;
  older worlds migrate innate effects without overwriting in-progress brews.
  Heating or cooling may trigger awakening, but can never diminish the
  magical properties of a potion, even after awakening. Old serialized
  `magicDecayTemperature` fields remain inert for save/vial compatibility.
  Irreversible awakening state is saved per particle.
- **Knowledge:** trials consume real potion and update one uniquely identified rabbit.
  A six-second recovery (three with the sanctuary) limits repeated exposure.
  All eight visual channels animate together in an isolation cage with a
  permanent before-dose reference. Muscles, courtship, seeded anatomical changes,
  flames and scorched fur, ice, illness, acid erosion and mortality
  have distinct shapes and motion. Dilute exposures are visually amplified
  monotonically; zero channels remain absent. Replay and pause never consume a
  dose or update rabbit statistics. Each rabbit keeps cumulative exposure and
  lasting injuries. A finite shared pen supports breeding and maturation; babies
  tolerate much less potion. Overdosed love and dangerous transformations can
  attack pen companions. An immediate cull tool and isolation cage let the player
  manage that danger. Buying another rabbit never revives or heals an animal.
  The ID form
  always starts from the player’s prior estimates or zero. Estimates are
  explicitly supplied and bounded. Fingerprints include batch UUID, enchantment
  concentrations and relative preparation portions. IDs tolerate only sub-visible
  settling (.15 percentage points of magic and .2 points of source proportions);
  seals use the exact sealed fingerprint. A smaller dose retains
  identity, while new batches or altered effects invalidate IDs and seals.
- **Reworking:** a sealed vial carries compact, versioned liquid parcels with
  all material fields, temperature, awakening state and original
  affinity envelopes. Testing scales their mass and mixture amount with the
  dose; consumed parcels never return. Pour back transfers the entire remainder
  after checking both volume and particle capacity. Unchanged pot parcels
  absorb matching fractions, preventing fragmentation in repeated full-pot
  cycles; distinct material states are never averaged into pristine ingredients.
  Costs and preparation portions transfer without replenishing stock. Reopening
  starts a new batch UUID and clears negotiations, requiring another trial and
  ID; older seals remain archived but do not apply. Saves made before reversible
  bottling reconstruct known average properties. Transfer payloads are excluded
  from trial, ID, discovery and sale archives to keep saves bounded.
- **Trading:** an initial offer and a four-round negotiation use the ID’s claims,
  budget and quantity. The actual sample does not secretly set the counter offer.
  Acceptance is required before a modern sale. Real effects are assessed on
  delivery and recorded privately for subsequent claims. No immediate quality
  readout reveals hidden values.
- **Returns:** receipts mature after 2.5–5 minutes or two to three subsequent
  commissions. Out-of-range effectiveness, a short vial or unwanted effects
  produce a genuine claim; 26% of fully compliant buyers bluff. Refunds debit
  cash and put shortfalls into existing guild debt. Ignored claims settle after
  one minute, including after reload. The expert seal costs at least 90 coins or
  150% of the commission budget, is immutable and batch-specific, and defeats
  only false claims on compliant delivery. A seal never excuses genuine faults.
- **Persistence:** version-five validation bounds all IDs, negotiation state,
  certificates, receipts and claims. Version-four saves retain active orders
  while fresh orders switch to magical requirements. Legacy mixture targets
  append the new thermal channels without replacing existing concentrations.

The renderer reconstructs only contacting liquids using reusable density and
color buffers, then adds bounded surface highlights and rounded grains. The
spoon’s oval bowl matches its local influence. Particle packing and collisions
are independent of display resolution. The mixture solver caches integer field
views; fluid contacts use scalar weights instead of per-pair temporary arrays.
Touch mapping accounts for the canvas's centered letterboxing on small screens.
Brewing rendering pauses behind rooms; one cached enclosure provides trial
motion at at most 30fps and stops repainting while paused or hidden. Sprite and
background caches avoid per-frame asset generation. Playback, dose and rabbit
controls fit phone screens using compact rows and horizontal scrolling.

`tests/magical-shop.test.mjs` covers manual estimates, negotiated receipts,
certification identity, truthful and bluff refunds, offline settlement, scarce
harvests, heat solubility, heat-stable magic and opposed-threshold awakening.
Browser acceptance covers visible actions and viewport bounds. Existing engine
regressions retain the original sandbox’s physics and phase behavior.
`tests/potion-return.test.mjs` covers conservation, full-pot cycles, irreversible
states, reload, atomic rejection, certification invalidation and old vials.
`tests/creature-visuals.test.mjs` covers dilute/mixed/dose responses and fresh
trials. Browser acceptance checks visible pixels for every magical channel and
the complete sealed-vial → test → reload → return → adjust → retest flow.
