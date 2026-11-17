import { z } from 'zod';

export const colorSchema = z.string().regex(/^#[0-9a-f]{6}$/iu).transform((color) => color.toLowerCase());
export const defaultDialogTransparency = 24;
export const maxDialogTransparency = 40;

export const appearanceSchema = z.strictObject({
  background: colorSchema,
  accent: colorSchema,
  fontFamily: z.enum(['system', 'sans', 'serif', 'mono']),
  fontSize: z.number().int().min(14).max(20),
  dialogTransparency: z.number().int().min(0).max(maxDialogTransparency).nullable().default(null),
  dialogTint: colorSchema.nullable().default(null),
});
export type Appearance = z.infer<typeof appearanceSchema>;

export const defaultAppearance: Appearance = {
  background: '#f5f5f3',
  accent: '#526647',
  fontFamily: 'system',
  fontSize: 15,
  dialogTransparency: null,
  dialogTint: null,
};
