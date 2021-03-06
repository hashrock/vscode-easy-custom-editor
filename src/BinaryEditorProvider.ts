import * as path from 'path';
import * as vscode from 'vscode';
import { disposeAll } from './dispose';
import { getNonce } from './util';
import { WebviewCollection } from './WebviewCollection';
import { BinaryEdit } from './BinaryEditor';
import { BinaryDocument } from "./BinaryDocument";
import { getViewHtml } from './view';

export interface BinaryEditorOption{
	viewType: string;
	extension: string;
}

export class BinaryEditorProvider implements vscode.CustomEditorProvider<BinaryDocument> {
	private static newFileId = 1;

	public static register(context: vscode.ExtensionContext, option: BinaryEditorOption): vscode.Disposable {

		vscode.commands.registerCommand(`${option.viewType}.new`, () => {
			const workspaceFolders = vscode.workspace.workspaceFolders;
			if (!workspaceFolders) {
				vscode.window.showErrorMessage("Creating new Files currently requires opening a workspace");
				return;
			}

			const uri = vscode.Uri.joinPath(workspaceFolders[0].uri, `new-${BinaryEditorProvider.newFileId++}.${option.extension}`)
				.with({ scheme: 'untitled' });

			vscode.commands.executeCommand('vscode.openWith', uri, option.viewType);
		});

		return vscode.window.registerCustomEditorProvider(
			option.viewType,
			new BinaryEditorProvider(context),
			{
				webviewOptions: {
					retainContextWhenHidden: true,
				},
				supportsMultipleEditorsPerDocument: false,
			});
	}

    /**
     * Tracks all known webviews
     */

	private readonly webviews = new WebviewCollection();

	constructor(
		private readonly _context: vscode.ExtensionContext
	) { }

	async openCustomDocument(
		uri: vscode.Uri,
		openContext: { backupId?: string; },
		_token: vscode.CancellationToken
	): Promise<BinaryDocument> {
		const document: BinaryDocument = await BinaryDocument.create(uri, openContext.backupId, {
			getFileData: async () => {
				const webviewsForDocument = Array.from(this.webviews.get(document.uri));
				if (!webviewsForDocument.length) {
					throw new Error('Could not find webview to save for');
				}
				const panel = webviewsForDocument[0];
				const response = await this.postMessageWithResponse<number[]>(panel, 'getFileData', {});
				return new Uint8Array(response);
			}
		});

		const listeners: vscode.Disposable[] = [];

		listeners.push(document.onDidChange(e => {
			// Tell VS Code that the document has been edited by the use.
			this._onDidChangeCustomDocument.fire({
				document,
				...e,
			});
		}));

		listeners.push(document.onDidChangeContent(e => {
			// Update all webviews when the document changes
			for (const webviewPanel of this.webviews.get(document.uri)) {
				this.postMessage(webviewPanel, 'update', {
					edits: e.edits,
					content: e.content,
				});
			}
		}));

		document.onDidDispose(() => disposeAll(listeners));

		return document;
	}


	async resolveCustomEditor(
		document: BinaryDocument,
		webviewPanel: vscode.WebviewPanel,
		_token: vscode.CancellationToken
	): Promise<void> {
		// Add the webview to our internal set of active webviews
		this.webviews.add(document.uri, webviewPanel);

		// Setup initial content for the webview
		webviewPanel.webview.options = {
			enableScripts: true,
		};
		webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);

		webviewPanel.webview.onDidReceiveMessage(e => this.onMessage(document, e));

		// Wait for the webview to be properly ready before we init
		webviewPanel.webview.onDidReceiveMessage(e => {
			if (e.type === 'ready') {
				if (document.uri.scheme === 'untitled') {
					this.postMessage(webviewPanel, 'init', {
						untitled: true
					});
				}
				else {
					this.postMessage(webviewPanel, 'init', {
						value: document.documentData
					});
				}
			}
		});
	}


	private readonly _onDidChangeCustomDocument = new vscode.EventEmitter<vscode.CustomDocumentEditEvent<BinaryDocument>>();
	public readonly onDidChangeCustomDocument = this._onDidChangeCustomDocument.event;


	public saveCustomDocument(document: BinaryDocument, cancellation: vscode.CancellationToken): Thenable<void> {
		return document.save(cancellation);
	}


	public saveCustomDocumentAs(document: BinaryDocument, destination: vscode.Uri, cancellation: vscode.CancellationToken): Thenable<void> {
		return document.saveAs(destination, cancellation);
	}


	public revertCustomDocument(document: BinaryDocument, cancellation: vscode.CancellationToken): Thenable<void> {
		return document.revert(cancellation);
	}


	public backupCustomDocument(document: BinaryDocument, context: vscode.CustomDocumentBackupContext, cancellation: vscode.CancellationToken): Thenable<vscode.CustomDocumentBackup> {
		return document.backup(context.destination, cancellation);
	}

    /**
     * Get the static HTML used for in our editor's webviews.
     */

	private getHtmlForWebview(webview: vscode.Webview): string {
		const scriptUri = webview.asWebviewUri(vscode.Uri.file(
			path.join(this._context.extensionPath, 'media', 'dist', 'assets', 'js', 'index.js')
		));
		// const styleUri = webview.asWebviewUri(vscode.Uri.file(
		// 	path.join(this._context.extensionPath, 'media', 'pawDraw.css')
		// ));

		const nonce = getNonce();
		const cspSource = webview.cspSource;

		return getViewHtml(cspSource, nonce, scriptUri);
	}


	private _requestId = 1;
	private readonly _callbacks = new Map<number, (response: any) => void>();


	private postMessageWithResponse<R = unknown>(panel: vscode.WebviewPanel, type: string, body: any): Promise<R> {
		const requestId = this._requestId++;
		const p = new Promise<R>(resolve => this._callbacks.set(requestId, resolve));
		panel.webview.postMessage({ type, requestId, body });
		return p;
	}


	private postMessage(panel: vscode.WebviewPanel, type: string, body: any): void {
		panel.webview.postMessage({ type, body });
	}


	private onMessage(document: BinaryDocument, message: any) {
		switch (message.type) {
			case 'update':
				document.makeEdit(message as BinaryEdit);
				return;

			case 'response':
				{
					const callback = this._callbacks.get(message.requestId);
					callback?.(message.body);
					return;
				}
		}
	}
}

