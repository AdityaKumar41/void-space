/**
 * The VOID·STUDIO launch guide.
 *
 * Written for someone sitting in front of the editor, not for someone changing
 * the fork. Every control named here is one the running editor actually shows.
 */

export interface GuideStep {
  readonly title: string;
  readonly body: string;
}

export interface GuideKeys {
  readonly keys: string;
  readonly does: string;
}

export type GuideBlock =
  | { readonly kind: 'p'; readonly text: string }
  | { readonly kind: 'steps'; readonly items: readonly GuideStep[] }
  | { readonly kind: 'list'; readonly items: readonly string[] }
  | { readonly kind: 'keys'; readonly rows: readonly GuideKeys[] }
  | { readonly kind: 'note'; readonly text: string };

export interface GuidePage {
  readonly slug: string;
  readonly title: string;
  readonly kicker: string;
  readonly summary: string;
  readonly group: 'Start' | 'The editor' | 'VOID·SPACE';
  readonly blocks: readonly GuideBlock[];
}

export const GUIDE: readonly GuidePage[] = [
  {
    slug: '',
    title: 'Use VOID·STUDIO',
    kicker: 'Launch guide',
    summary: 'Open the editor, find your way around, and publish only when you mean to.',
    group: 'Start',
    blocks: [
      {
        kind: 'p',
        text: 'VOID·STUDIO is the browser editor for a 3D model. You shape the scene on this machine. VOID·SPACE receives it only when you publish.',
      },
      {
        kind: 'steps',
        items: [
          {
            title: 'Start the editor',
            body: 'From the repository, run pnpm studio:fork:dev. The editor answers at http://localhost:5007. Opening the HTML file from disk will not start it.',
          },
          {
            title: 'Use a WebGPU browser',
            body: 'Chrome or Edge. The viewport is WebGPU. A browser without it shows a page and no model.',
          },
          {
            title: 'Sign in when you want the platform',
            body: 'You can model with no account. Sign-in, Copilot sessions, and Publish need VOID·SPACE and the Studio API running beside the editor.',
          },
        ],
      },
      {
        kind: 'note',
        text: 'This guide is the map. Open /docs on the platform, or /docs on the editor. Both addresses are this same set of pages.',
      },
    ],
  },
  {
    slug: 'sign-in',
    title: 'Sign in',
    kicker: 'Account',
    summary: 'Link the editor to the person already signed in on VOID·SPACE.',
    group: 'Start',
    blocks: [
      {
        kind: 'p',
        text: 'The editor does not have its own password. It borrows the VOID·SPACE session, then keeps a token in this browser.',
      },
      {
        kind: 'steps',
        items: [
          {
            title: 'Open the VOID·SPACE panel',
            body: 'The panel sits on the editor. Its tabs are Bridge & Publish and AI Copilot.',
          },
          {
            title: 'Press Sign in on VOID·SPACE',
            body: 'A new tab opens the platform. If you are already signed in, that tab hands the session back and closes. The original editor tab then shows your name.',
          },
          {
            title: 'Or paste a token',
            body: 'Token Link is the same handshake, typed by hand, when the tab cannot close itself.',
          },
        ],
      },
      {
        kind: 'note',
        text: 'From the platform, Open Studio follows /login and then /studio/connect. That path mints the editor token and returns you to the editor.',
      },
    ],
  },
  {
    slug: 'screen',
    title: 'The screen',
    kicker: 'Layout',
    summary: 'A menu bar, a 3D view, and a properties column.',
    group: 'The editor',
    blocks: [
      {
        kind: 'p',
        text: 'The window opens as three regions. The top bar is File, Edit, Add, and Session. The large region is the viewport. The right column is properties for whatever is active.',
      },
      {
        kind: 'list',
        items: [
          'The viewport header switches the tool. Sculpt, box modelling, and the other modes live there, on the scene, not in a separate app.',
          'Add, or Shift+A in the viewport, opens the menu of things you can place, including a light.',
          'Session → Save Default File stores the scene that New opens next. Clear Default File returns that to the stock scene.',
          'The icon at the right of the menu bar shows the console, which is the editor’s own log.',
        ],
      },
    ],
  },
  {
    slug: 'files',
    title: 'Files',
    kicker: 'Open and save',
    summary: 'Projects stay in a .wproj file until you export or publish.',
    group: 'The editor',
    blocks: [
      {
        kind: 'p',
        text: 'File is the whole document. An export is a mesh you can hand to another program. Publish, on the VOID·SPACE panel, is the only path into the platform library.',
      },
      {
        kind: 'keys',
        rows: [
          { keys: 'File → New', does: 'Start from the default scene.' },
          { keys: 'File → Open', does: 'Load a project file.' },
          { keys: 'File → Load last autosave', does: 'Restore the last automatic copy the editor wrote.' },
          { keys: 'File → Save With Toolstack', does: 'Save the project and its undo history.' },
          { keys: 'File → Save As', does: 'Write a new project file.' },
          { keys: 'File → Import 3D Asset', does: 'Bring a mesh into the open scene.' },
          { keys: 'File → Export', does: 'Write glTF (.glb), OBJ, STL, or PLY. glTF keeps materials.' },
        ],
      },
      {
        kind: 'note',
        text: 'The project extension is .wproj. That name is the file format. Renaming it would orphan files you already saved.',
      },
    ],
  },
  {
    slug: 'viewport',
    title: 'Move the view',
    kicker: 'Viewport',
    summary: 'Orbit, pan, and zoom without leaving the tool you are using.',
    group: 'The editor',
    blocks: [
      {
        kind: 'p',
        text: 'Left-drag in the viewport belongs to the current tool: a sculpt stroke, a selection, a transform. The view itself uses the other buttons, so a brush and the camera do not share one drag.',
      },
      {
        kind: 'keys',
        rows: [
          { keys: 'Middle-drag or right-drag', does: 'Orbit around the view target.' },
          { keys: 'Alt+drag', does: 'Orbit, including with the left button.' },
          { keys: 'Shift+middle-drag or Shift+right-drag', does: 'Pan.' },
          { keys: 'Scroll', does: 'Zoom toward the target.' },
          { keys: 'Ctrl+middle-drag or Ctrl+right-drag', does: 'Zoom by dragging.' },
          { keys: 'Ctrl+left-click', does: 'Place the 3D cursor, when the tool does not take that click.' },
          { keys: '.', does: 'Frame the selection.' },
          { keys: 'Ctrl+Z', does: 'Undo.' },
          { keys: 'Ctrl+Shift+Z or Ctrl+Y', does: 'Redo.' },
        ],
      },
    ],
  },
  {
    slug: 'model',
    title: 'Shape a model',
    kicker: 'Modelling',
    summary: 'Pick a tool in the viewport header, then work on the active object.',
    group: 'The editor',
    blocks: [
      {
        kind: 'steps',
        items: [
          {
            title: 'Choose the mode',
            body: 'The viewport header lists the tool modes for the scene. Sculpt pushes the surface. Box modelling edits polygons: faces, edges, and vertices, with an x-ray option when you need to see through the mesh.',
          },
          {
            title: 'Select, then edit',
            body: 'In select mode, A selects everything in view and Alt+A clears that. The properties column shows the active object. Undo is one step for the whole stroke or edit.',
          },
          {
            title: 'Add what the scene is missing',
            body: 'Shift+A, or the Add menu, places a light and the other objects that menu lists. Import brings in a mesh you already have.',
          },
        ],
      },
      {
        kind: 'note',
        text: 'Materials for a mesh can be painted as PBR maps from the Copilot tab: albedo on the material, with normal, roughness, and metallic stored beside it.',
      },
    ],
  },
  {
    slug: 'copilot',
    title: 'Copilot',
    kicker: 'AI',
    summary: 'Ask for a scene change. Accepted commands land in the viewport as one undo step.',
    group: 'The editor',
    blocks: [
      {
        kind: 'p',
        text: 'Open the VOID·SPACE panel and choose AI Copilot. Type in Ask Copilot and press Send. A chip fills the same box: Audit budget, Add crate, or Chrome material.',
      },
      {
        kind: 'steps',
        items: [
          {
            title: 'A change you can undo',
            body: 'When a command is accepted, the editor applies it locally and tells you it is one undo step. Ctrl+Z reverses that whole step. The model proposes. The editor’s command system applies.',
          },
          {
            title: 'Image to 3D',
            body: 'Choose a PNG, JPEG, or WebP, then press Image to 3D. With Meshy configured, that service builds the mesh. Without it, the editor builds a height field from the picture and says so in the reply. A height field is a relief, not a reconstructed object.',
          },
          {
            title: 'PBR maps',
            body: 'Type a surface, for example brushed chrome, and press PBR maps. Those maps are generated in the editor and assigned to the mesh.',
          },
        ],
      },
      {
        kind: 'note',
        text: 'Signed out, a plain sentence the editor already understands still runs as a local command, and the reply says it was local. Anything that needs the model asks you to sign in first. If the model host is down, the panel says so and falls back to that same local reading when it can.',
      },
    ],
  },
  {
    slug: 'publish',
    title: 'Publish',
    kicker: 'VOID·SPACE',
    summary: 'Send the scene to the library as a named asset, on purpose.',
    group: 'VOID·SPACE',
    blocks: [
      {
        kind: 'p',
        text: 'Bridge & Publish is the handoff. Sign in first. The panel shows the platform address, how many assets are already published, and your name when the session is linked.',
      },
      {
        kind: 'steps',
        items: [
          {
            title: 'Run the readiness audit when you want a score',
            body: 'Pre-Publish Audit scores the export from measurements on this machine. Below the recommended line, review can still accept the asset. Publish anyway is an explicit second press.',
          },
          {
            title: 'Open Publish to VOID·SPACE',
            body: 'Name the asset, pick a format, a category, tags, and a description. glTF binary is the format that keeps materials and textures. OBJ, STL, PLY, and FBX are the other choices in that list.',
          },
          {
            title: 'A new version of an open asset',
            body: 'If you opened the editor on an existing library asset, the form can publish as a new version of that asset. Leave it unchecked to create a separate record.',
          },
        ],
      },
      {
        kind: 'note',
        text: 'The tenant publish credential stays on the Studio API. The browser never holds it. After a publish, Manage in Console opens the asset on VOID·SPACE.',
      },
    ],
  },
  {
    slug: 'boundaries',
    title: 'What leaves the machine',
    kicker: 'Boundaries',
    summary: 'Modelling stays here. Identity comes in. Publish goes out.',
    group: 'VOID·SPACE',
    blocks: [
      {
        kind: 'p',
        text: 'Opening the editor, working for an hour, and closing it uploads nothing. The project lives in the browser and in the project file you save.',
      },
      {
        kind: 'list',
        items: [
          'Sign-in is the inbound crossing: your VOID·SPACE user, workspace, and role.',
          'Publish is the outbound crossing: the exported file, its name, category, tags, and description.',
          'Copilot sends the instruction and a summary of the scene, then returns commands. The document itself is not the upload.',
          'A scene, its textures, and its undo stack are not mirrored into VOID·SPACE because the editor is open.',
        ],
      },
      {
        kind: 'steps',
        items: [
          {
            title: 'The viewport is blank',
            body: 'Confirm the browser has WebGPU, and that you opened http://localhost:5007 from the running editor server.',
          },
          {
            title: 'Sign-in does nothing',
            body: 'VOID·SPACE has to be up on port 3000 and the Studio API on its own port. Sign in on the platform first, then use Sign in on VOID·SPACE in the panel.',
          },
          {
            title: 'Copilot replies and the mesh does not change',
            body: 'Read the reply. A refused proposal is named. A local stand-in is named. Undo is available when a command was applied.',
          },
          {
            title: 'Publish stays on browse only',
            body: 'The panel states the requirement. Publishing needs a linked session and the Studio API’s tenant credential configured on the server.',
          },
        ],
      },
    ],
  },
];

const bySlug = new Map(GUIDE.map((page) => [page.slug, page]));

export function guidePage(slug: string): GuidePage | undefined {
  return bySlug.get(slug);
}

export function guideNeighbors(slug: string): {
  readonly previous?: GuidePage;
  readonly next?: GuidePage;
} {
  const index = GUIDE.findIndex((page) => page.slug === slug);
  if (index < 0) return {};
  return {
    previous: index > 0 ? GUIDE[index - 1] : undefined,
    next: index < GUIDE.length - 1 ? GUIDE[index + 1] : undefined,
  };
}

export function guideHref(page: GuidePage): string {
  return page.slug ? `/docs/${page.slug}` : '/docs';
}
