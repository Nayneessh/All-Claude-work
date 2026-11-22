# Design

## Palette

| Name | Hex | Role |
| --- | --- | --- |
| Soft Champagne | `#F5E6C8` | Page ground and large surfaces |
| Clinical Sage | `#4A6B5D` | Header, primary buttons, selected cards, headings, links |
| Golden Amber | `#B38336` | Hairlines, dividers, icons, selected marks. Not for text |
| Soft Oat | `#EFECE6` | Cards, forms, alternate sections |
| Deep Sage (derived) | `#243A31` | Body text |
| Deep Amber (derived) | `#6F4C14` | Small gold text and input borders |

Measured contrast (WCAG): Sage on Champagne 4.80, Champagne on Sage 4.80, Sage on Oat 5.01, Deep Sage on Champagne 9.88, Deep Amber on Champagne 6.26. Amber on Champagne is 2.74 and fails as text, so it is used only for lines and icons. Automated axe checks over 30 public pages (both languages), the whole assessment flow and the console report no WCAG 2.1 A/AA violations.

No other hues are used. Status never relies on colour alone: confidence labels have a shape and text; errors have an icon and text.

## Typography

* Headings: Cormorant Garamond, 28 px and above only (its small letters are tiny).
* Body and interface: Manrope.
* Hindi headings: Tiro Devanagari Hindi; Hindi body: Noto Sans Devanagari, set larger with a 1.8 line height.
* All fonts are self-hosted from npm packages (no third-party request).

## Header and logo

The logo area is reserved top right, fixed size, empty, showing exactly "Your logo goes over here." It is not translated. A real logo replaces its contents with no layout change. The English / हिन्दी switch sits to its left; navigation to the left of that. On phones a menu button replaces the navigation and the logo area stays top right.

## Mobile

Camera screen is a full-width 3:4 frame with controls in thumb reach; tap targets are 44 px or more; no page scrolls sideways at 360 px (tested for 36 pages).
