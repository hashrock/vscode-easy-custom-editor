
/**
 * Define the type of edits used in paw draw files.
 */
export interface BinaryEdit {
	readonly snapshot: Uint8Array;
}

export interface BinaryDocumentDelegate {
	getFileData(): Promise<Uint8Array>;
}


