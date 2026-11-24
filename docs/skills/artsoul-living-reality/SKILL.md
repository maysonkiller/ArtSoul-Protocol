---
name: artsoul-living-reality
description: Build physically plausible, material-specific digital experiences in 2D, 2.5D, 3D, web UI, motion graphics and virtual spaces. Verify support, occlusion, gravity, lighting, material response, scale, accessibility and real runtime evidence before release.
license: MIT
metadata:
  author: ArtSoul Atlas extension
  version: '1.0.0'
  source-as-of: '2026-11-23'
  compatible-atlas: 'Classic v1.0.3; Adaptive v1.1.0; Adaptive FAST v1.1.1'
  status: 'ADDITIVE_CANDIDATE'
---

# ArtSoul Living Reality — Живая реальность

## Goal and routing

Use when a digital object should feel as if it could exist, be touched, or occupy real space. This is not a mandate to maximize 3D effects, photorealism or GPU work. It extends rather than replaces `artsoul-premium-seasonal-experience` v1.1.0, CLEAN-COPY-01 and the Atlas verification contract. Use as a primary module with at most two task-specific supporting modules. On seasonal web releases, combine with Premium Seasonal Experience and verification; use the thorough profile, not the low-risk FAST lane. Do not silently modify Classic, claim a new installed OpenAI skill, or expand deployment permissions.

## LR-01 — physical audit first

Inventory actual routes, dimensions, material-bearing surfaces, layout ownership, stacking contexts, existing controls and responsive states. Distinguish flat ink, filled panels, physical rails, curved controls, transparent links, art/media, and inert background. A DOM box is not itself a physical shelf. Check real page source and rendered DOM; one screenshot of a mock is not the site. Choose the scene's gravity, light direction and material vocabulary before drawing. Freeze existing brand, semantic text, interaction contract and functional scope.

## LR-02 — contact, support and gravity

For each ornament specify support object, contact seam, top-facing surface, overlap, shadow direction and occlusion. Snow collects more on near-horizontal surfaces; steep surfaces retain thinner deposits. For a 3D model, reason from world-space surface normals and up vector; `max(0, dot(N, up))` is a starting heuristic, not a physical snow simulation. For a 2D web component use the real visible geometry and its upper boundary. Sample an elliptical top arc for round or rounded controls; use width, height, border radii, border widths and clipping as inputs. Join a granular irregular upper silhouette to the boundary with slight contact overlap. Never leave a transparent gap between snow and its support. For overflowing hidden/clip surfaces put the deposit inside the visible edge or omit it. Taper to zero on steep sides; icicles must originate at a ledge and point downward. A bare text label has no box shelf; use a glyph-clipped frost highlight or restrained text shading; never add a floating white rectangle. For small elements, remove detail rather than obscure icons or letters. Distinguish falling snow in the air from settled snow; no visual claim of collision simulation when using independent particles.

## LR-03 — material and coherent illumination

Think of a material by roughness, transmission, reflectance, surface microstructure and thickness. Snow: matte diffuse highlight, soft pale blue indirect light, granular silhouette, narrow darker contact seam. Ice: translucent blue-green volume and stronger edge highlights, sparse pointed icicles. Felt: saturated fabric body, soft diffuse highlights and directional folds rather than hard plastic specular shine. Fur: irregular soft edge, locally shaded fibers and rounded pompom. Metal: controlled directional warm reflection. Glass: clear silhouette, restrained edge reflections, and content legibility. Choose a consistent key light and darker lower/contact edges. Use shadow mainly to show contact rather than universal neon halos. CSS/SVG gradients and seams are visual approximations of PBR concepts, not physically based ray tracing. Do not pretend a 2D design has computed true light transport. Avoid repetitive scaled clones: generate stable bounded variation based on actual geometry, with per-object seeds and proportionate thickness.

## LR-04 — atmosphere and depth

Establish three compositing depths: background environmental light, object surfaces with material and contact, foreground sparse particles. Fog should soften contrast with perceived distance, not whiten every foreground action. Use low-frequency density variation, overlapping soft bands, slow drift; in true 3D consider depth-based exponential fog or volumetric scattering where justified. Keep key text and focus rings clear. Distinct moods require silhouette, material, palette, density and motion differences; a hue shift alone is not a new scene. Winter uses colder diffuse light, heavier settled snow and ice; New Year uses softer warm light, a small amount of powder and purposeful festive materials. Original removes seasonal geometry and lighting. Snow on/off remains independent of the chosen atmosphere; explain whether it controls precipitation rather than settled deposits.

## LR-05 — stable attachment and interaction

Attach wearables to an existing stable visual host, not mutable avatar contents. Measure the actual anchor after layout; derive width and contact point, keep face and other controls visible, re-anchor after state changes, layout changes and node replacement. Decorative DOM and SVG are `aria-hidden`, not focusable, and pointer-transparent. Use distinct SVG gradient IDs per instance. Preserve focus, text, hit targets, routes, forms, existing theme and i18n. Avoid changing base layout or protected transaction/access logic. Reconcile stale decorators on removal/reclassification; use bounded scheduling and a geometry signature, not repeated uncontrolled append or lifetime counters. Respect reduced motion, forced colors, hidden tab and storage errors. No unrequested WebGL, external runtime, paid API or asset import.

## LR-06 — renderer decision

Use CSS for ink, gradients and simple atmospheric fields; SVG for small vector objects, contact profiles, authored curves and material gradients; Canvas2D for bounded moving particles; Three.js/WebGL only if a true spatial scene, interaction, occlusion, shadows or material response materially needs it. For true 3D prefer a small measured scene, consistent camera and lighting, glTF where appropriate, tested low-power fallback, documented assets/licensing, and verified resource disposal. Compare high and low quality paths. A game/3D example is not permission to introduce an engine into a transactional website. Avoid expensive real-time turbulence/blur per particle. Test rather than promise FPS.

## LR-07 — acceptance and evidence

1. Baseline: exact repository revision, preview target, rollback ID, scope and relevant source paths. Freeze production until owner GO.
2. Geometry: inspect at 320, 375, 390, 768, 1024 and 1440 CSS px; check device DPR/text zoom when available. Verify no unsupported caps, contact seam overlap, round-arc fit, no duplicate caps on wearables, no clipped icon or horizontal overflow.
3. State: mode/independent snowfall, guest/connected/disconnected mock and rerender; real account visual check only when safely available; repeat across locale and theme; keyboard, click-through, dynamic rehydration, reduced motion, forced colors, original cleanup.
4. Visual: compare matched before/after viewport screenshots; review at 100% zoom and at mobile size. Check gravity/contact, directional shadows, focus, contrast, different silhouettes and background continuity. If original content is obscured or material looks suspended, revise. Report actual visual observations and remaining uncertainty.
5. Engineering: verify exact source hashes, syntax, no unrelated changes, deployment READY, all expected routes/assets built, actual remote HTTP and live browser where possible. Record PASS, FAIL, NOT_RUN or BLOCKED separately for static, isolated fixture, real preview, physical iPhone/Safari, and performance/transaction checks. A local mock is never live E2E. No actual wallet signatures/payments for visual QA.
6. Deliver: reusable skill as a versioned additive artifact, source/evidence, confirmed preview URL, rollback ID, explicit release gate. Do not merge/deploy production just because preview built. Keep legacy Atlas intact until the owner authorizes a new combined version.

## Research provenance — verified public references (2026-11-23)

These are conceptual references; the skill text and ArtSoul SVG/CSS code are original synthesis. No third-party shader, runtime or art was copied or installed.

- OpenAI, `threejs-data-visualization` skill: https://github.com/openai/plugins/blob/main/plugins/build-web-data-visualization/skills/threejs-data-visualization/SKILL.md — choose simplest renderer that satisfies a genuine spatial/volumetric requirement; performance and visual checking.
- OpenAI Developer Showcase, Material Lab: https://developers.openai.com/showcase/material-lab — example of interactive light/form/material exploration with controls for surface parameters and environment. A showcase, not proof of a new built-in ChatGPT 3D engine.
- OpenAI, *Accelerating engineering for the physical world* (2026-11-03): https://openai.com/index/accelerating-engineering-for-the-physical-world/ — engineering design and simulation capabilities; not a confirmation of a general ChatGPT 3D editor.
- Google Filament, physically based material guide: https://github.com/google/filament/blob/main/docs/Materials.md.html — material parameters, roughness, indirect occlusion and cloth shading.
- Khronos glTF Sample Viewer: https://github.com/KhronosGroup/glTF-Sample-Viewer — material variants, lighting, tone mapping, transmission, cloth sheen and scene validation in an actual 3D pipeline.
- NVIDIA SnowAccumulation technical note: https://download.nvidia.com/developer/SDK/Individual_Samples/DEMOS/Direct3D9/src/SnowAccumulation/Docs/SnowAccumulation.pdf — slope-dependent accumulation and controlled variation. Treat it as a heuristic, not complete snow physics.
- Three.js fog manual: https://github.com/mrdoob/three.js/blob/dev/manual/pages/fog.html — linear and exponential distance fog.
- Three.js volumetric example: https://github.com/mrdoob/three.js/blob/dev/examples/webgpu_volume_caustics.html — density texture and scattering variation, illustrative only; no WebGPU import for ArtSoul's existing UI.

## Adoption status

This is a supplemental candidate, not a claim to have installed a tool or synchronized every ChatGPT Space. Keep the original Atlas unchanged and reference `artsoul-living-reality` alongside the selected seasonal and verification modules. Promote it after real design review, evidence and owner approval.
