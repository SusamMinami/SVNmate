# DLSS5 Update Audit - 2026-09-17

## Decision

Keep the currently verified Seria runtime active. Do not replace individual
components in place.

Revisit a coordinated RenoDX + Bridge update when Bridge 1.4.13 becomes stable,
then compare both packages in the same Seria scene before promoting it.

## Installed

| Component | Installed build | SHA-256 | Decision |
| --- | --- | --- | --- |
| ReShade | 6.8.0.2155 | `0CEE63F9C9F13F3AC909C5B4903F4DBB4B719A7AB3B4F13B0DEAF83C814B94F7` | Current |
| RenoDX DLSS5 | 0.2026.0827.2036 | `87AEF9DDD937C7241E6BF8D8EFEA0045D63559135E254C60DAB316DB3D3A4AEE` | Keep verified build |
| Seria DX11 bridge | 1.0.27.0, project-patched | `81420DB003BD9A28F0CB17CCECB665F4E4EA7BA3528E06B2703684A7CA427841` | Keep until coordinated A/B test |
| DLSS SR | 310.8.0.0 | `C85F971CE023C9F3492FC7455F0B01A24BA18EA39636407A846902C4360B0B7E` | Keep |
| DLSS NR | 310.8.SF.0, Ada-patched | `6EB209E764F39872625DEBD6ABAF45E2BB6322F6F270F781F70C059AE30B3927` | Keep; required by RTX 4080 |

## Findings

### ReShade

The official site still lists 6.8.0 as current:
https://reshade.me/

No update is needed.

### RenoDX

The rolling release currently exposes two same-version builds. The installer
manifest selects `renodx-dlss5-v2.5.addon64`, SHA-256
`A2973900531D58FF7BEB21172828095BCE2281BC2A81E82191F9D89C983D6A21`.

Sources:

- https://github.com/yumlevi/renodx-dlss-installer/releases/tag/latest
- https://raw.githubusercontent.com/yumlevi/renodx-dlss-installer/main/manifest.ini

The Bridge documentation states that these same-version builds have different
D3D12 proxy requirements. Updating RenoDX alone is therefore unsafe. The
installed `87AE...` build is already proven with the Seria bridge and RTX 4080
runtime.

### DLSS5 Bridge

Upstream stable is 1.4.12, SHA-256
`4F2ACECC1026AE89AC0B92767BE66CEEA2662AD0EF88710B89C7DA7840D548D4`.
Its headline changes are Vulkan format fixes; it also includes the 1.4.11
D3D11 stall/resume correction.

The directly relevant D3D11 fix for depth and motion-vector textures larger
than the color image first appears in the 1.4.13 prerelease line. This matches
Seria's known padded/non-matching texture risk, but 1.4.13 remains prerelease
and has since changed hook implementation and lifecycle handling.

Sources:

- https://github.com/NIGos/dlss5-bridge/releases
- https://github.com/NIGos/dlss5-bridge/releases/tag/v1.4.12
- https://github.com/NIGos/dlss5-bridge/pull/34
- https://github.com/NIGos/dlss5-bridge/blob/main/VERIFYING-DOWNLOADS.md

The current Seria bridge is older by version number but was specifically
validated with the project's padded-texture and D3D12 feature fixes. Replacing
it without an in-game A/B test could regress the exact path already fixed.

Only download Bridge assets from the official GitHub repository. The project
explicitly warns that `dlss5bridge.com` is unaffiliated and its installer has
been classified as malicious.

### Neural Upstream and managers

Neural Upstream moves Neural Rendering before DLSS Super Resolution to reduce
pixel cost, trading some fidelity for performance. Its documented route
requires a D3D12 game with native DLSS. Seria currently runs D3D11 through a
private D3D12 bridge, so it is not a drop-in update for this package.

General-purpose DLSS5 managers are useful for consumer game libraries but may
replace the known Seria-specific bridge, RTX 4080 runtime, configuration, and
QA overlay. Do not point them at the internal Seria build.

Reference:
https://www.digitalfoundry.net/news/2026/09/dlss-5-mod-shifts-load-to-second-gpu-doubling-frame-rates-and-latency

## Promotion Gate

An update is eligible only when all of the following pass:

1. Bridge 1.4.13 or later is a stable official release with a published hash.
2. RenoDX and Bridge are updated together in a separate candidate package.
3. RTX 4080 keeps the Ada-patched `nvngx_dlssnr.dll`; no Blackwell-only runtime
   replaces it.
4. Seria starts in D3D11 at 2560x1440 with `NeuralUplift=0` and `skip_exe=2`.
5. A fixed scene shows delivered frames for at least ten minutes without
   bridge shutdown, ghosting, padded-region corruption, or task-overlay failure.
6. Frame time and image quality are compared against the current recovery
   package before the manifest is changed.
