/**
 * The Copilot's tool catalogue — the complete, fixed set of functions the model may call
 * (VS2-SRS-1.0 §7.2, FR-11.2).
 *
 * The governing principle is §7.1: **AI proposes, the command system applies.** The Copilot never
 * mutates the scene document. It returns calls to functions in this file, each of which is validated
 * and then converted into Commands — the same ones a mouse drag produces. That is what makes every
 * AI action reviewable and undo-able, and it is why §7.2 says the model is "instructed to respond
 * only with calls to these tools, never with instructions to run arbitrary script."
 *
 * Two properties of this file are load-bearing and are asserted by `test/copilot.test.ts`:
 *
 *   1. **The set is closed.** Membership is a property of `STUDIO_TOOLS`, so a tool the model
 *      invents is not merely unimplemented, it is unrepresentable.
 *   2. **`publish` is not in it, and cannot be.** FR-11.5 forbids a Copilot action from triggering a
 *      publish: publishing always needs an explicit human action, mirroring VOID·SPACE's own
 *      human-in-the-loop constraint (VS-SRS-2.0 FR-7.6). This is the single most important absence
 *      in the file, which is why it has its own test rather than a comment.
 */
import { z } from 'zod';

/**
 * Bumped whenever a tool is added, removed, or has its parameters changed.
 *
 * §7.2 requires the schema to be *versioned*, and §7.5 requires every logged AI exchange to record
 * the prompt-template version. Storing this alongside a `CopilotMessage` is what lets an audit
 * answer "which tool set produced this edit" months later, when the catalogue has moved on.
 */
export const STUDIO_TOOL_SCHEMA_VERSION = '1.0.0';

/** FR-4.1 — the primitive kinds the modeling tools can generate. */
export const PRIMITIVE_KINDS = ['cube', 'sphere', 'cylinder', 'cone', 'plane', 'torus'] as const;
export type PrimitiveKind = (typeof PRIMITIVE_KINDS)[number];

/** FR-4.4 — the non-destructive modifier stack, in the Blender sense. */
export const MODIFIER_KINDS = [
  'Subdivision Surface',
  'Mirror',
  'Array',
  'Solidify',
  'Bevel',
  'Decimate',
] as const;
export type ModifierKind = (typeof MODIFIER_KINDS)[number];

/** FR-6.1 — the PBR channels the simple material editor exposes. */
export const MATERIAL_PROPERTIES = [
  'baseColor',
  'metallic',
  'roughness',
  'normal',
  'ao',
  'emissive',
] as const;
export type MaterialProperty = (typeof MATERIAL_PROPERTIES)[number];

/**
 * A scene coordinate. Bounded well beyond any plausible authored scene, because §7.2 requires a
 * bounds sanity check and this is what makes an absurd value rejectable rather than merely unlikely.
 *
 * A model that hallucinates a position of `1e9` would otherwise place a mesh so far from the origin
 * that the viewport appears empty and the user cannot find what changed.
 */
export const SCENE_COORDINATE_LIMIT = 100_000;

const coordinate = z
  .number()
  .finite()
  .refine((value) => Math.abs(value) <= SCENE_COORDINATE_LIMIT, {
    message: `A coordinate must be within ±${SCENE_COORDINATE_LIMIT}; beyond that the object is unreachable in the viewport`,
  });

const vec3 = z.tuple([coordinate, coordinate, coordinate]);

/** Scale must be strictly positive: a zero or negative scale collapses or inverts geometry. */
const scaleVec3 = z.tuple([
  z.number().positive().finite().max(SCENE_COORDINATE_LIMIT),
  z.number().positive().finite().max(SCENE_COORDINATE_LIMIT),
  z.number().positive().finite().max(SCENE_COORDINATE_LIMIT),
]);

/**
 * Object ids are opaque strings, not UUIDs, because they identify nodes in the Yjs scene document
 * (§3.4) rather than rows in Postgres. Pinning them to a UUID shape here would make the tool schema
 * disagree with the document it edits.
 */
const objectId = z.string().min(1).max(128);

/** FR-3.2 / FR-4.1 — create a primitive with adjustable generation parameters. */
export const addPrimitiveSchema = z.object({
  kind: z.enum(PRIMITIVE_KINDS),
  name: z.string().min(1).max(120).optional(),
  location: vec3.default([0, 0, 0]),
  scale: scaleVec3.default([1, 1, 1]),
  /**
   * Per-primitive generation parameters (segments, radius, major/minor radius …). Free-form on
   * purpose: the set is genuinely per-kind, and narrowing it here would duplicate FR-4.1's own table.
   */
  parameters: z.record(z.union([z.number(), z.string(), z.boolean()])).optional(),
});

/**
 * FR-3.2 — transform an existing object.
 *
 * Rotation is in **degrees**, not radians. The Copilot is translating a person's sentence, and a
 * person says "rotate it 90 degrees"; forcing the model to convert first adds a failure mode with
 * no upside. The command layer converts once, at the boundary.
 */
export const setTransformSchema = z
  .object({
    objectId,
    /** Replace the translation. Relative moves are expressed by the caller reading the current one. */
    translate: vec3.optional(),
    /** Euler angles in degrees, applied in XYZ order. */
    rotate: vec3.optional(),
    scale: scaleVec3.optional(),
  })
  .refine(
    (value) => value.translate !== undefined || value.rotate !== undefined || value.scale !== undefined,
    // A transform call that changes nothing would still push an undo step, so undo would appear to
    // do nothing once - exactly the "silently skipped" behaviour FR-11.3 forbids.
    { message: 'setTransform requires at least one of translate, rotate or scale' },
  );

/** FR-6.1 — set one PBR channel on an object's material. */
export const setMaterialPropertySchema = z.object({
  objectId,
  property: z.enum(MATERIAL_PROPERTIES),
  /**
   * Numbers are 0–1 for the scalar PBR channels; `baseColor` and `emissive` accept a CSS-style hex
   * string. Both shapes are accepted because the model naturally produces either, and rejecting the
   * "wrong" one would be a schema argument the user cannot see or resolve.
   */
  value: z.union([z.number().finite(), z.string().min(1).max(64)]),
  /** Optional material slot for multi-material meshes; defaults to the first slot. */
  slot: z.number().int().min(0).max(63).optional(),
});

/** FR-4.4 — apply one entry in the non-destructive modifier stack. */
export const applyModifierSchema = z.object({
  objectId,
  modifier: z.enum(MODIFIER_KINDS),
  /** e.g. `{ levels: 2 }` for Subdivision, `{ count: 5 }` for Array. */
  parameters: z.record(z.union([z.number(), z.string(), z.boolean()])).optional(),
  /** Lets the model propose a modifier without enabling it, matching FR-11.8's confirm-first rule. */
  enabled: z.boolean().default(true),
});

/** FR-3.3 — group objects under a new Empty/Group node. */
export const groupObjectsSchema = z.object({
  // At least two: grouping one object is a rename, and silently treating it as such would leave the
  // user with a hierarchy change they never asked for.
  objectIds: z.array(objectId).min(2).max(200),
  name: z.string().min(1).max(120).optional(),
});

/** FR-3.1 — remove an object from the scene. */
export const deleteObjectSchema = z.object({
  objectId,
  /** Deleting a node with children is refused unless this is set, so a subtree is never lost by accident. */
  recursive: z.boolean().default(false),
});


/**
 * FR-11.6 — text-to-3D or image-to-3D via Meshy AI.
 *
 * The result lands as a **tagged draft object**, not as finished work: §7.4's review pattern requires
 * the Creator to edit or accept it like any AI suggestion, mirroring VS-SRS-2.0's own
 * suggestion/acceptance flow (FR-7.5). Nothing in this file marks generated geometry as approved.
 */
export const generateMeshSchema = z
  .object({
    /** What to generate. Text-to-3D. */
    prompt: z.string().min(3).max(2_000).optional(),
    /** Reference image for image-to-3D. A data URL or a content reference, never a raw blob. */
    imageRef: z.string().min(1).max(2_048).optional(),
    name: z.string().min(1).max(120).optional(),
    targetPolycount: z.number().int().min(100).max(500_000).optional(),
  })
  .refine((value) => value.prompt !== undefined || value.imageRef !== undefined, {
    // A generation call with neither input would bill a provider for nothing.
    message: 'generateMesh requires either a prompt or an imageRef',
  });

/**
 * FR-11.7 — text-to-texture, producing a full PBR set (albedo/normal/roughness).
 *
 * `resolution` is a closed set rather than a range: texture sizes are powers of two in practice, and
 * an arbitrary value would either be silently rounded by the service or fail there, where the error
 * is far less legible than here.
 */
export const generateTextureSchema = z.object({
  prompt: z.string().min(3).max(2_000),
  objectId,
  resolution: z.union([z.literal(512), z.literal(1_024), z.literal(2_048), z.literal(4_096)]).optional(),
});

/**
 * The closed set of tool names.
 *
 * Declared as a value so the type is derived from it rather than restated, exactly as
 * `ASSET_STATUSES` does in `@void-space/types`. `publish` is deliberately absent — see the file
 * header and FR-11.5.
 */
export const STUDIO_TOOL_NAMES = [
  'addPrimitive',
  'setTransform',
  'setMaterialProperty',
  'applyModifier',
  'groupObjects',
  'deleteObject',
  'generateMesh',
  'generateTexture',
] as const;
export type StudioToolName = (typeof STUDIO_TOOL_NAMES)[number];

/** Why a tool exists, so a caller can group the catalogue the way §6.1's panels are grouped. */
export type StudioToolCategory = 'modeling' | 'material' | 'organisation' | 'generation';

/**
 * FR-18.1 — the AI capabilities a TenantAdmin can switch off tenant-wide.
 *
 * Declared here, in the lowest package that both the API and the AI subsystem depend on, because this
 * is a **domain enum rather than an implementation detail**: the editor's validator has to know which
 * features gate which tools, the worker has to know which calls to refuse, and the admin console has
 * to render the list. Two unions with the same name and different members is exactly how a feature
 * ends up enforced in one place and forgotten in another — which is what happened when this lived in
 * two packages, and why it now lives in one.
 *
 * `readinessAudit` carries no tool, because the audit is not something the model can invoke — it is a
 * workflow the Creator runs. It is still a feature a tenant disables, so it belongs in this list.
 */
export const STUDIO_AI_FEATURES = [
  'copilot',
  'readinessAudit',
  'generativeMesh',
  'generativeTexture',
] as const;
export type StudioAiFeature = (typeof STUDIO_AI_FEATURES)[number];

export interface StudioToolDefinition {
  readonly name: StudioToolName;
  /**
   * The description handed to Claude. Written for a model, not a person: it states when to reach for
   * the tool, and the units it takes, because those are the two things a schema cannot say.
   */
  readonly description: string;
  readonly schema: z.ZodTypeAny;
  readonly category: StudioToolCategory;
  readonly mutatesScene: boolean;
  /**
   * Set when the tool spends a metered third-party call, so §7.5's per-tenant feature flag and rate
   * limit can be applied before the work is enqueued rather than after it is paid for.
   */
  readonly aiFeature?: StudioAiFeature;
}


/**
 * The catalogue itself. Its keys are `StudioToolName`, so a name that is not in the union cannot be
 * registered and a registered tool cannot be forgotten.
 */
export const STUDIO_TOOLS: Readonly<Record<StudioToolName, StudioToolDefinition>> = {
  addPrimitive: {
    name: 'addPrimitive',
    description:
      'Add a new primitive mesh to the scene. Use for requests like "add a cube" or "put a sphere next to the crate". All six Blender-familiar kinds are available; pass generation parameters for anything beyond the default. Coordinates are in metres, matching the scene origin.',
    schema: addPrimitiveSchema,
    category: 'modeling',
    mutatesScene: true,
  },
  setTransform: {
    name: 'setTransform',
    description:
      'Set the translation, rotation or scale of an existing object, identified by objectId from the scene summary. Rotation is in degrees, applied in XYZ order. Provide only the components the request actually changes.',
    schema: setTransformSchema,
    category: 'modeling',
    mutatesScene: true,
  },
  setMaterialProperty: {
    name: 'setMaterialProperty',
    description:
      'Change one PBR channel on an object\'s material. Scalar channels (metallic, roughness, ao) take 0–1; baseColor and emissive take a hex colour string such as "#8b5a2b". Call once per channel — "make it metallic and dark" is two calls.',
    schema: setMaterialPropertySchema,
    category: 'material',
    mutatesScene: true,
  },
  applyModifier: {
    name: 'applyModifier',
    description:
      'Add or adjust a non-destructive modifier on an existing object, for example Subdivision Surface for smoothing or Decimate to reduce a polycount for XR. The modifier is non-destructive, so this is always reversible; set enabled=false to propose one without changing the render.',
    schema: applyModifierSchema,
    category: 'modeling',
    mutatesScene: true,
  },
  groupObjects: {
    name: 'groupObjects',
    description:
      'Group two or more existing objects under a new parent Empty, so they move together. Use when a request refers to several objects as one thing ("group the crates"). Requires at least two objectIds.',
    schema: groupObjectsSchema,
    category: 'organisation',
    mutatesScene: true,
  },
  deleteObject: {
    name: 'deleteObject',
    description:
      'Remove an object from the scene. Refused if the object has children unless recursive is true, because a subtree must never be deleted by implication.',
    schema: deleteObjectSchema,
    category: 'organisation',
    mutatesScene: true,
  },
  generateMesh: {
    name: 'generateMesh',
    description:
      'Generate a new mesh from a text prompt (text-to-3D) or a reference image (image-to-3D). The result is inserted as a draft asset tagged as AI-generated, which the user must review — never present generated geometry as finished. This call is metered, so prefer editing existing geometry when the request allows it.',
    schema: generateMeshSchema,
    category: 'generation',
    mutatesScene: true,
    aiFeature: 'generativeMesh',
  },
  generateTexture: {
    name: 'generateTexture',
    description:
      'Generate a full PBR texture set (albedo, normal, roughness) for an existing object from a prompt, and assign it as a proposed material. The user accepts or edits the result; do not describe it as final. This call is metered.',
    schema: generateTextureSchema,
    category: 'generation',
    mutatesScene: true,
    aiFeature: 'generativeTexture',
  },
};

/** Narrows an arbitrary string from a model response to a known tool, or tells you it is not one. */
export function isStudioToolName(value: string): value is StudioToolName {
  return (STUDIO_TOOL_NAMES as readonly string[]).includes(value);
}

/** The catalogue as an array, in declaration order — convenient for building the Claude request. */
export function listStudioTools(): readonly StudioToolDefinition[] {
  return STUDIO_TOOL_NAMES.map((name) => STUDIO_TOOLS[name]);
}

