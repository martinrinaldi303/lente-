---
name: Vision Telemetry Console
colors:
  surface: '#101318'
  surface-dim: '#101318'
  surface-bright: '#36393f'
  surface-container-lowest: '#0b0e13'
  surface-container-low: '#191c21'
  surface-container: '#1d2025'
  surface-container-high: '#272a2f'
  surface-container-highest: '#32353a'
  on-surface: '#e1e2e9'
  on-surface-variant: '#bec8d2'
  inverse-surface: '#e1e2e9'
  inverse-on-surface: '#2e3036'
  outline: '#88929b'
  outline-variant: '#3e4850'
  surface-tint: '#89ceff'
  primary: '#89ceff'
  on-primary: '#00344d'
  primary-container: '#0ea5e9'
  on-primary-container: '#003751'
  inverse-primary: '#006591'
  secondary: '#bdf4ff'
  on-secondary: '#00363d'
  secondary-container: '#00e3fd'
  on-secondary-container: '#00616d'
  tertiary: '#2fe378'
  on-tertiary: '#003918'
  tertiary-container: '#00b359'
  on-tertiary-container: '#003c1a'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#c9e6ff'
  primary-fixed-dim: '#89ceff'
  on-primary-fixed: '#001e2f'
  on-primary-fixed-variant: '#004c6e'
  secondary-fixed: '#9cf0ff'
  secondary-fixed-dim: '#00daf3'
  on-secondary-fixed: '#001f24'
  on-secondary-fixed-variant: '#004f58'
  tertiary-fixed: '#62ff95'
  tertiary-fixed-dim: '#2fe378'
  on-tertiary-fixed: '#00210b'
  on-tertiary-fixed-variant: '#005226'
  background: '#101318'
  on-background: '#e1e2e9'
  surface-variant: '#32353a'
typography:
  headline-lg:
    fontFamily: Inter
    fontSize: 1.5rem
    fontWeight: '600'
    lineHeight: 2rem
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Inter
    fontSize: 1.125rem
    fontWeight: '600'
    lineHeight: 1.5rem
    letterSpacing: -0.015em
  headline-sm:
    fontFamily: Inter
    fontSize: 0.875rem
    fontWeight: '600'
    lineHeight: 1.25rem
    letterSpacing: -0.01em
  body-lg:
    fontFamily: Inter
    fontSize: 0.875rem
    fontWeight: '400'
    lineHeight: 1.375rem
  body-md:
    fontFamily: Inter
    fontSize: 0.8125rem
    fontWeight: '400'
    lineHeight: 1.25rem
  body-sm:
    fontFamily: Inter
    fontSize: 0.75rem
    fontWeight: '400'
    lineHeight: 1.125rem
  label-lg:
    fontFamily: JetBrains Mono
    fontSize: 0.8125rem
    fontWeight: '500'
    lineHeight: 1.125rem
    letterSpacing: -0.01em
  label-md:
    fontFamily: JetBrains Mono
    fontSize: 0.75rem
    fontWeight: '500'
    lineHeight: 1rem
    letterSpacing: 0em
  label-sm:
    fontFamily: JetBrains Mono
    fontSize: 0.6875rem
    fontWeight: '500'
    lineHeight: 0.875rem
    letterSpacing: 0.02em
  data-mono:
    fontFamily: JetBrains Mono
    fontSize: 0.75rem
    fontWeight: '400'
    lineHeight: 1rem
    letterSpacing: -0.02em
  telemetry-metric:
    fontFamily: JetBrains Mono
    fontSize: 1.25rem
    fontWeight: '600'
    lineHeight: 1.5rem
    letterSpacing: -0.03em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  gutter: 0.5rem
  gutter-compact: 0.25rem
  margin: 0.75rem
  margin-panel: 0.5rem
  space-xxs: 0.125rem
  space-xs: 0.25rem
  space-sm: 0.375rem
  space-md: 0.5rem
  space-lg: 0.75rem
  space-xl: 1rem
  space-xxl: 1.5rem
---

## Brand & Style

This design system is tailored for an advanced optical engineering HUD console and robotics vision workstation. The visual direction merges precision instrument minimalism with high-density data displays, drawing inspiration from modern observability platforms, robotic flight controllers, and computer vision suites.

### Brand Personality & Audience
- **Target Audience:** Vision systems engineers, robotics developers, optical firmware specialists, and XR hardware operators.
- **Tone & Mood:** Tactical, strictly utilitarian, silent, and authoritative. It removes decorative ornamentation in favor of absolute signal-to-noise clarity, rapid diagnostic parsing, and unwavering stability during live operations.
- **Design Philosophy:** Anti-gamer, anti-skeuomorphic, and anti-clutter. Every pixel, edge, and colored glyph corresponds directly to active machine states, neural inference pipelines, sensor streams, or interactive controls.

### Design Movement
**Minimalist Functional Engineering Workstation:** Monochromatic architectural foundations with ultra-fine hair-thin delineations, dense typographic grids, and high-contrast telemetry signals.

## Colors

The palette relies on deep, near-black slate tones to minimize eye fatigue during multi-monitor and in-headset debugging sessions, contrasted with calibrated functional accents.

### Core Canvas & Surfaces
- **Canvas Base (`#0b0d10`):** The foundational substrate for viewports and root shells.
- **Surface Elevation 1 (`#111419`):** Standard panel and module card backgrounds.
- **Surface Elevation 2 (`#171b22`):** Elevated sidebars, toolbars, and contextual dialogs.
- **Surface Active / Hover (`#1f242e`):** Transient active states, table row hovers, and input focus bases.
- **Border Subtle (`#232936`):** Structural partition lines, data grid delineations, and component boundaries.
- **Border Prominent (`#2d3446`):** Focused panel peripheries, active window seams, and splitters.

### Functional & Signal Accents
- **Primary Interactive (`#0ea5e9`):** Command triggers, selected telemetry tabs, focused input highlights, and active tools.
- **Telemetry Cyan (`#00e5ff`):** Bounding boxes, inference confidence vectors, frame rate overlays, and raw optical telemetry tags.
- **Nominal / Connected Emerald (`#00d26a`):** Hardware heartbeat, linked wireless feeds, nominal thermal states, and synchronized camera pipes.
- **Warning / Pipeline Bottleneck Amber (`#f59e0b`):** Frame drops, camera latency spikes, drift warnings, and inference delays.
- **Critical / Error Crimson (`#ef4444`):** Disconnected nodes, optical occlusion, thermal throttling, and hardware fault alerts.
- **Informational Violet (`#8b5cf6`):** Secondary classification layers, point cloud overlays, and depth map segmentation.

### Text Contrast Tiers
- **Text Primary (`#f1f5f9`):** Critical metrics, raw output numbers, active panel headers, and core inputs.
- **Text Secondary (`#94a3b8`):** Variable labels, unit measures, sensor names, and inactive states.
- **Text Muted / Code Comments (`#475569`):** Disabled triggers, metadata timestamps, and inactive axis guides.

## Typography

Typographic scale is structured for high-density diagnostic clarity. The system pairs `Inter` for spatial interface architecture, command toolbars, and contextual menus with `JetBrains Mono` for all data visualizations, bounding-box annotations, frame rates, terminal output, and numerical telemetry.

### Typographic Hierarchy Rules
- **Tabular Figures:** All numeric data, coordinates, timestamps, and metric values must enforce tabular figures (`font-variant-numeric: tabular-nums`) to prevent horizontal jitter during rapid stream re-renders.
- **Density Over Scale:** Headers never exceed `1.5rem` (`24px`). Desktop layout dominance is maintained via spatial positioning, crisp divider lines, and text weight contrast rather than oversized type.
- **Monospace Encasement:** All raw node names, ROS topic IDs, hardware registers, and coordinates default strictly to `label-md` or `data-mono`.
- **Text Transformations:** Metric abbreviations (e.g., `FPS`, `MS`, `FOV`, `LUX`, `IMU`, `RGBD`) and status indicators must be rendered in uppercase with subtle letter-spacing for legibility at sub-pixel sizes.

## Layout & Spacing

The layout operates on a compact, dense **4px spatial grid** optimized for professional engineering workstations spanning ultra-wide desktop monitors down to mobile hardware field diagnostics.

### Layout Mechanics
- **Multi-Pane Docking System:** The UI is partitioned using CSS Grid and absolute Flex layouts simulating an IDE/workstation (e.g., left pipeline tree, central camera/optical feeds with HUD viewport, right real-time telemetry inspector, and bottom stream logs).
- **Zero-Waste Margins:** Module gaps and gutters default to `0.5rem` (`8px`) or `0.25rem` (`4px`) in compact telemetry inspectors to prioritize visual real estate for sensor feeds.
- **Viewport Fluidity:** The central viewport containing the camera feeds expands dynamically to fill remaining canvas dimensions while preserving aspect-ratio locks (16:9, 4:3, or custom dual-lens stereoscopic 1:1 viewports).

### Breakpoints & Adaptability
- **Desktop / Multi-Monitor (>1440px):** 4-column master view (System Pipeline, Dual Stereoscopic Feed, Diagnostics Matrix, Hardware Log Stream).
- **Laptop / Compact Workstation (1024px - 1439px):** 3-column layout; Log stream docks into a collapsible bottom drawer.
- **Field Tablet / Mobile Diagnostic (<1023px):** Single-pane layout with sliding drawer sheets; Viewport takes top 60% of vertical height, tabbed telemetry docked below.

## Elevation & Depth

This design system avoids blurry drop shadows, heavy skeuomorphism, and vibrant glassmorphism to preserve pure optical contrast and prevent graphics-card compositing overhead during intensive 60-120fps video stream rendering.

### Elevation via Tonal Layering
Depth is communicated through dark step-tones combined with hair-thin 1px borders:
- **Base Canvas (`#0b0d10`):** Recessed canvas plane. Dedicated solely to background workspaces and the optical viewport framing.
- **Panel Base (`#111419`):** Primary panel container, separated by a crisp 1px stroke of `Border Subtle` (`#232936`). No shadow.
- **Floating Overlays & Inspections (`#171b22`):** Dropdowns, context menus, and telemetry overlays inside the video stream use this elevated surface with a 1px border of `Border Prominent` (`#2d3446`) and a directional drop: `box-shadow: 0 4px 12px rgba(0, 0, 0, 0.65)`.
- **HUD Target Reticles & Bounding Boxes:** Rendered directly over raw pixels using 1px crisp strokes of `#00e5ff` or `#00d26a` with an alpha layer of 12% to guarantee underlying pixel visibility.

## Shapes

The interface embraces a strict, architectural geometry using subtle, soft chamfers to preserve an industrial, mechanical profile without feeling abrasive.

### Shape Geometry Rules
- **Structural Modules & Dock Panes:** `0px` radius (flush edge-to-edge docking) against viewport edges; `0.25rem` (`4px`) when decoupled or floating.
- **Buttons, Field Inputs, & Selectors:** Uniform `0.25rem` (`4px`) corner radii.
- **Pills & Status Bullets:** Retain circular `9999px` radii for telemetry nodes and online/offline status indicators strictly under 8px diameter.
- **Focus Indicators:** Sharp 1px outline offset by 1px with no soft blur rings (`outline: 1px solid #0ea5e9; outline-offset: 1px`).

## Components

### Buttons & Trigger Controls
- **Primary Action:** Solid background of `#0ea5e9`, text color `#0b0d10` (weight 600) for maximum contrast against dark UI. Hover shifts to `#38bdf8`. Active press: `#0284c7`.
- **Secondary Action:** Transparent base with 1px border of `#2d3446`, text in `#f1f5f9`. Hover: background `#171b22`, border `#3b82f6`.
- **Destructive Action:** Subtle background of `rgba(239, 68, 68, 0.1)`, 1px border of `rgba(239, 68, 68, 0.3)`, text `#ef4444`. Hover: border `#ef4444`.
- **Dimensions:** Compact 28px height (`py-1`, `px-3`), font `label-md`.

### Status Indicators & Badges
- **Hardware Status Nodes:** 6px solid circular pips with an optional 1.5px non-blurry status ring. 
  - Connected: `#00d26a`.
  - Processing / Buffering: `#f59e0b`.
  - Disconnected / Missing: `#ef4444`.
- **Telemetry Chips / Badges:** Rectangular tags with `roundedness-1` (`4px`), background `#171b22`, border `1px solid #232936`, typography `label-sm`. Values prefixed with an uppercase indicator label (e.g., `EXP: 1/250s`, `RES: 4K-RAW`).

### Data Tables & Stream Lists
- **Structure:** Tight vertical cadence with row heights capped at 24px to 28px.
- **Header:** Sticky top, text `#475569`, uppercase `label-sm`, bottom border `1px solid #232936`.
- **Row Separation:** Horizontal single-pixel boundary `#171b22`. Hover row background `#171b22`.
- **Numeric Columns:** Right-aligned, formatted with `JetBrains Mono` and active tabular numerals.

### Input Fields & Sliders
- **Text Inputs:** Height 28px, background `#0b0d10`, border `1px solid #232936`, font `label-md`, text `#f1f5f9`. Focus: border `#0ea5e9`.
- **Engineering Sliders (Exposure, Gain, Focus):** 
  - Track: 2px thickness `#232936`. Fill track: `#0ea5e9`.
  - Thumb: 10px square or 10px tall vertical bar `#f1f5f9` with zero shadow. Value displays in adjacent monospace label.

### Vision HUD Viewport Overlays
- **Bounding Boxes:** 1px stroke `#00e5ff` with 0px corner tags (corner crosshairs). Text tag positioned atop top-left corner with `#00e5ff` background, `#0b0d10` text, font size `10px` bold monospace.
- **Crosshairs & Reticles:** Hairline 1px `#94a3b8` at 30% opacity, crossing at optical center.
- **HUD Diagnostic Strip:** Semi-opaque dark backplane (`rgba(11, 13, 16, 0.75)`) docked along the bottom of the video stream showing FPS, dropped frames, optical temperature, and sync drift.