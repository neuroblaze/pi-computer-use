export interface PermissionSource {
	attribution: "helper-app" | "caller";
	pid?: number;
	parentPid?: number;
	executablePath?: string;
	parentPath?: string;
	parentBundleId?: string;
	os?: string;
}

export interface PermissionStatus {
	accessibility: boolean;
	screenRecording: boolean;
	screenRecordingPreflight?: boolean;
	source?: PermissionSource;
}
