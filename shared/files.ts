import { z } from 'zod';
import { fileLocationSchema, idSchema, relativePathSchema, titleSchema } from './actions.ts';
import type { FileLocation } from './actions.ts';

export const DEMO_ROOT_ID = 'demo';
export const MAX_NOTE_BYTES = 1024 * 1024;
export const MAX_PDF_BYTES = 128 * 1024 * 1024;

export const fileKindSchema = z.enum(['markdown', 'pdf']);
export type FileKind = z.infer<typeof fileKindSchema>;
export const localPickerSchema = z.strictObject({
  kind: z.enum(['markdown', 'pdf', 'obsidian-note', 'obsidian-vault', 'vscode-file', 'vscode-folder', 'root-folder']),
  rootId: idSchema.optional(),
});
export type LocalPickerRequest = z.infer<typeof localPickerSchema>;
export type LocalPickerResult =
  | { kind: 'document'; location: FileLocation; roots: RootGrant[] }
  | { kind: 'obsidian'; vault: string; file: string }
  | { kind: 'path'; path: string };
export const rootSchema = z.strictObject({
  id: idSchema, label: titleSchema, directory: z.string().min(1).max(1800), writable: z.boolean(),
});
export type RootGrant = z.infer<typeof rootSchema>;
export const librarySchema = z.strictObject({
  rootId: idSchema,
  folder: z.union([z.literal(''), relativePathSchema]),
  kind: z.enum(['all', 'markdown', 'pdf']),
  search: z.string().max(120),
  metadata: z.literal('1').optional(),
});
export type LibraryQuery = z.infer<typeof librarySchema>;
export const noteWriteSchema = z.strictObject({
  ...fileLocationSchema.shape,
  version: z.string().regex(/^[a-f0-9]{64}$/u),
  text: z.string().max(MAX_NOTE_BYTES).refine((text) => text.isWellFormed() && !text.includes('\x00')),
});
export type ListedFile = { path: string; kind: FileKind; modifiedAt?: number; createdAt?: number; bytes?: number };
export type FileListing = { files: ListedFile[]; limited: boolean };
export type NoteDocument = { text: string; version: string; obsidianUri: string; writable: boolean };
export type NoteSaveResult = { note: NoteDocument; backupFile: string };

export function fileKind(path: string): FileKind | undefined {
  if (/\.md$/iu.test(path)) return 'markdown';
  if (/\.pdf$/iu.test(path)) return 'pdf';
}
