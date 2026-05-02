import Cocoa
import WebKit
import os

private let log = OSLog(subsystem: "com.linekforge.flock", category: "App")

class AppDelegate: NSObject, NSApplicationDelegate {
    var window: NSWindow!
    var webView: WKWebView!
    var daemonProcess: Process?
    var webProcess: Process?

    private var isDevMode: Bool {
        ProcessInfo.processInfo.arguments.contains("--dev")
    }

    private var bundledDir: String {
        return Bundle.main.bundleURL
            .appendingPathComponent("Contents/Resources").path
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        ensureServices { ready in
            DispatchQueue.main.async {
                if ready {
                    self.setupWindow()
                } else {
                    self.showStartupError()
                }
            }
        }
    }

    // MARK: - Services

    private func ensureServices(completion: @escaping (Bool) -> Void) {
        ensureDaemon { daemonReady in
            guard daemonReady else {
                completion(false)
                return
            }
            if self.isDevMode {
                self.waitForWebServer(attempts: 30, completion: completion)
            } else {
                self.ensureWebServer(completion: completion)
            }
        }
    }

    private func ensureDaemon(completion: @escaping (Bool) -> Void) {
        checkDaemon { alive in
            if alive {
                os_log("Daemon already running on 9801", log: log, type: .info)
                completion(true)
            } else {
                self.startProcess(
                    script: "\(self.bundledDir)/daemon/src/index.ts",
                    cwd: "\(self.bundledDir)/daemon",
                    store: { self.daemonProcess = $0 },
                    label: "daemon"
                )
                self.waitForDaemon(attempts: 30, completion: completion)
            }
        }
    }

    private func ensureWebServer(completion: @escaping (Bool) -> Void) {
        checkWebServer { alive in
            if alive {
                os_log("Web server already running on 5800", log: log, type: .info)
                completion(true)
            } else {
                self.startWebPreview()
                self.waitForWebServer(attempts: 30, completion: completion)
            }
        }
    }

    private func startWebPreview() {
        let distDir = "\(bundledDir)/web-dist"
        let fm = FileManager.default
        guard fm.fileExists(atPath: "\(distDir)/index.html") else {
            os_log("Web dist not found: %{public}@", log: log, type: .error, distDir)
            return
        }

        let bunPath = findBun()
        os_log("Starting web server: %{public}@ serving %{public}@", log: log, type: .info, bunPath, distDir)

        let serveScript = """
        Bun.serve({
          port: 5800,
          hostname: "127.0.0.1",
          async fetch(req) {
            const url = new URL(req.url);
            let filePath = "\(distDir)" + url.pathname;
            if (url.pathname === "/" || !await Bun.file(filePath).exists()) {
              filePath = "\(distDir)/index.html";
            }
            const file = Bun.file(filePath);
            return new Response(file);
          }
        });
        """

        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: bunPath)
        proc.arguments = ["-e", serveScript]
        proc.standardOutput = FileHandle.nullDevice
        proc.standardError = FileHandle.nullDevice
        proc.environment = ProcessInfo.processInfo.environment

        do {
            try proc.run()
            webProcess = proc
        } catch {
            os_log("Failed to start web server: %{public}@", log: log, type: .error, error.localizedDescription)
        }
    }

    private func startProcess(script: String, cwd: String, store: @escaping (Process) -> Void, label: String) {
        let fm = FileManager.default
        guard fm.fileExists(atPath: script) else {
            os_log("%{public}@ script not found: %{public}@", log: log, type: .error, label, script)
            return
        }

        let bunPath = findBun()
        os_log("Starting %{public}@: %{public}@ run %{public}@", log: log, type: .info, label, bunPath, script)

        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: bunPath)
        proc.arguments = ["run", script]
        proc.currentDirectoryURL = URL(fileURLWithPath: cwd)
        proc.standardOutput = FileHandle.nullDevice
        proc.standardError = FileHandle.nullDevice
        proc.environment = ProcessInfo.processInfo.environment

        do {
            try proc.run()
            store(proc)
        } catch {
            os_log("Failed to start %{public}@: %{public}@", log: log, type: .error, label, error.localizedDescription)
        }
    }

    // MARK: - Port Check

    private func checkDaemon(completion: @escaping (Bool) -> Void) {
        DispatchQueue.global().async {
            let task = Process()
            let pipe = Pipe()
            task.executableURL = URL(fileURLWithPath: "/usr/bin/curl")
            task.arguments = ["-s", "--connect-timeout", "1", "http://127.0.0.1:9801/api/health"]
            task.standardOutput = pipe
            task.standardError = FileHandle.nullDevice
            do {
                try task.run()
                task.waitUntilExit()
                let data = pipe.fileHandleForReading.readDataToEndOfFile()
                let body = String(data: data, encoding: .utf8) ?? ""
                completion(task.terminationStatus == 0 && body.contains("\"app\":\"flock\""))
            } catch {
                completion(false)
            }
        }
    }

    private func checkWebServer(completion: @escaping (Bool) -> Void) {
        DispatchQueue.global().async {
            let task = Process()
            let pipe = Pipe()
            task.executableURL = URL(fileURLWithPath: "/usr/bin/curl")
            task.arguments = ["-s", "--connect-timeout", "1", "http://127.0.0.1:5800/"]
            task.standardOutput = pipe
            task.standardError = FileHandle.nullDevice
            do {
                try task.run()
                task.waitUntilExit()
                let data = pipe.fileHandleForReading.readDataToEndOfFile()
                let body = String(data: data, encoding: .utf8) ?? ""
                completion(task.terminationStatus == 0 && body.contains("Flock"))
            } catch {
                completion(false)
            }
        }
    }

    private func waitForWebServer(attempts: Int, completion: @escaping (Bool) -> Void) {
        guard attempts > 0 else {
            os_log("Flock web server failed to respond after 30 attempts", log: log, type: .error)
            DispatchQueue.main.async { completion(false) }
            return
        }
        DispatchQueue.global().asyncAfter(deadline: .now() + 0.5) {
            self.checkWebServer { alive in
                if alive {
                    completion(true)
                } else {
                    self.waitForWebServer(attempts: attempts - 1, completion: completion)
                }
            }
        }
    }

    private func waitForDaemon(attempts: Int, completion: @escaping (Bool) -> Void) {
        guard attempts > 0 else {
            os_log("Daemon failed to respond after 30 attempts", log: log, type: .error)
            DispatchQueue.main.async { completion(false) }
            return
        }
        DispatchQueue.global().asyncAfter(deadline: .now() + 0.5) {
            self.checkDaemon { alive in
                if alive {
                    completion(true)
                } else {
                    self.waitForDaemon(attempts: attempts - 1, completion: completion)
                }
            }
        }
    }

    private func findBun() -> String {
        let candidates = [
            "/opt/homebrew/bin/bun",
            "/usr/local/bin/bun",
            ProcessInfo.processInfo.environment["HOME"].map { "\($0)/.bun/bin/bun" },
        ].compactMap { $0 }
        for path in candidates {
            if FileManager.default.isExecutableFile(atPath: path) { return path }
        }
        return "bun"
    }

    // MARK: - Window + WebView

    private func showStartupError() {
        let alert = NSAlert()
        alert.messageText = "Flock could not start"
        alert.informativeText = "The Flock daemon or web UI did not become healthy. Stop any process using ports 9801 or 5800, then reopen Flock."
        alert.alertStyle = .critical
        alert.addButton(withTitle: "Quit")
        alert.runModal()
        NSApp.terminate(nil)
    }

    private func setupWindow() {
        let config = WKWebViewConfiguration()
        config.preferences.setValue(true, forKey: "developerExtrasEnabled")

        webView = WKWebView(frame: .zero, configuration: config)

        let savedFrame = UserDefaults.standard.string(forKey: "windowFrame")
        let frame: NSRect
        if let savedFrame = savedFrame {
            frame = NSRectFromString(savedFrame)
        } else {
            frame = NSRect(x: 100, y: 100, width: 1200, height: 800)
        }

        window = NSWindow(
            contentRect: frame,
            styleMask: [.titled, .closable, .resizable, .miniaturizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Flock"
        window.minSize = NSSize(width: 800, height: 500)
        window.contentView = webView
        window.delegate = self
        window.isReleasedWhenClosed = false
        window.titlebarAppearsTransparent = true

        let port = 5800
        webView.load(URLRequest(url: URL(string: "http://localhost:\(port)")!))
        os_log("Loading web from localhost:%d", log: log, type: .info, port)

        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    // MARK: - Lifecycle

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        window?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        return false
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return false
    }

    func applicationWillTerminate(_ notification: Notification) {
        daemonProcess?.terminate()
        webProcess?.terminate()
    }
}

// MARK: - NSWindowDelegate

extension AppDelegate: NSWindowDelegate {
    func windowWillClose(_ notification: Notification) {
        UserDefaults.standard.set(NSStringFromRect(window.frame), forKey: "windowFrame")
    }

    func windowDidResize(_ notification: Notification) {
        UserDefaults.standard.set(NSStringFromRect(window.frame), forKey: "windowFrame")
    }
}
