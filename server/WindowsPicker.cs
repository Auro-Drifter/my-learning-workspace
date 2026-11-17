using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Forms;

// Windows keeps an owned dialog above its owner. Use an intermediate window so the
// shell dialog's modal loop disables only this picker process's window.
public sealed class PickerOwner : NativeWindow, IWin32Window, IDisposable {
  private const int Popup = unchecked((int)0x80000000);
  private const int ToolWindow = 0x80;
  private const int Layered = 0x80000;
  private const int TopmostStyle = 8;
  private const int ShowWithoutActivation = 4;
  private const uint Alpha = 2;

  [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
  [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr window, int mode);
  [DllImport("user32.dll")] private static extern bool SetLayeredWindowAttributes(IntPtr window, uint color, byte opacity, uint flags);

  public PickerOwner() {
    var cursor = Cursor.Position;
    CreateHandle(new CreateParams {
      Parent = ForegroundBrowser(), Style = Popup, ExStyle = ToolWindow | Layered | TopmostStyle,
      X = cursor.X, Y = cursor.Y, Width = 1, Height = 1
    });
    if (SetLayeredWindowAttributes(Handle, 0, 0, Alpha)) ShowWindow(Handle, ShowWithoutActivation);
  }

  private static IntPtr ForegroundBrowser() {
    IntPtr window = GetForegroundWindow();
    uint process;
    if (window == IntPtr.Zero || GetWindowThreadProcessId(window, out process) == 0) return IntPtr.Zero;
    try {
      using (var application = System.Diagnostics.Process.GetProcessById((int)process)) {
        switch (application.ProcessName.ToLowerInvariant()) {
          case "msedge":
          case "chrome":
          case "firefox":
          case "brave":
            return window;
          default:
            return IntPtr.Zero;
        }
      }
    } catch (ArgumentException) { return IntPtr.Zero; }
  }

  public void Dispose() { DestroyHandle(); }
}

public sealed class PickerActivation : IDisposable {
  private const uint EventObjectShow = 0x8002;
  private const uint OutOfContext = 0;
  private const uint RootWindow = 2;
  private const uint KeepSizeAndPosition = 0x0001 | 0x0002;
  private static readonly IntPtr Topmost = new IntPtr(-1);
  private delegate void EventCallback(IntPtr hook, uint ev, IntPtr window, int objectId, int childId, uint thread, uint time);

  [DllImport("user32.dll", SetLastError = true)] private static extern IntPtr SetWinEventHook(
    uint first, uint last, IntPtr module, EventCallback callback, uint process, uint thread, uint flags);
  [DllImport("user32.dll")] private static extern bool UnhookWinEvent(IntPtr hook);
  [DllImport("user32.dll")] private static extern IntPtr GetAncestor(IntPtr window, uint flags);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr window, StringBuilder name, int max);
  [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr window);
  [DllImport("user32.dll")] private static extern bool SetWindowPos(IntPtr window, IntPtr order, int x, int y, int cx, int cy, uint flags);

  private readonly IntPtr hook;
  private GCHandle callbackHandle;

  public PickerActivation(uint process) {
    EventCallback callback = OnWindowShown;
    callbackHandle = GCHandle.Alloc(callback);
    hook = SetWinEventHook(EventObjectShow, EventObjectShow, IntPtr.Zero, callback, process, 0, OutOfContext);
    if (hook == IntPtr.Zero) {
      var error = new Win32Exception(Marshal.GetLastWin32Error());
      callbackHandle.Free();
      throw error;
    }
  }

  private void OnWindowShown(IntPtr eventHook, uint ev, IntPtr window, int objectId, int childId, uint thread, uint time) {
    if (objectId != 0 || childId != 0 || window == IntPtr.Zero || GetAncestor(window, RootWindow) != window) return;
    var name = new StringBuilder(16);
    GetClassName(window, name, name.Capacity);
    if (name.ToString() != "#32770") return;
    SetWindowPos(window, Topmost, 0, 0, 0, 0, KeepSizeAndPosition);
    SetForegroundWindow(window);
  }

  public void Dispose() {
    if (!callbackHandle.IsAllocated) return;
    UnhookWinEvent(hook);
    callbackHandle.Free();
  }
}

// The common Windows file dialog also supports selecting folders.
public static class PickerFolder {
  private const uint PickFolders = 0x20;
  private const uint ForceFileSystem = 0x40;
  private const uint PathMustExist = 0x800;
  private const uint FileSystemPath = 0x80058000;
  private const int Cancelled = unchecked((int)0x800704C7);

  [ComImport, Guid("DC1C5A9C-E88A-4DDE-A5A1-60F82A20AEF7")]
  private class FileOpenDialog { }

  [ComImport, Guid("42F85136-DB7E-439C-85F1-E4075D135FC8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  private interface FileDialog {
    [PreserveSig] int Show(IntPtr owner);
    // Keep the intervening methods in Windows SDK vtable order.
    void SetFileTypes(uint count, IntPtr filters);
    void SetFileTypeIndex(uint index);
    void GetFileTypeIndex(out uint index);
    void Advise(IntPtr events, out uint cookie);
    void Unadvise(uint cookie);
    void SetOptions(uint flags);
    void GetOptions(out uint flags);
    void SetDefaultFolder(ShellItem item);
    void SetFolder(ShellItem item);
    void GetFolder(out ShellItem item);
    void GetCurrentSelection(out ShellItem item);
    void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string name);
    void GetFileName(out IntPtr name);
    void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string title);
    void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string text);
    void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string label);
    void GetResult(out ShellItem item);
  }

  [ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  private interface ShellItem {
    void BindToHandler(IntPtr context, ref Guid handler, ref Guid iid, out IntPtr result);
    void GetParent(out ShellItem parent);
    void GetDisplayName(uint type, [MarshalAs(UnmanagedType.LPWStr)] out string name);
  }

  [DllImport("shell32.dll", CharSet = CharSet.Unicode, ExactSpelling = true)]
  private static extern int SHCreateItemFromParsingName(string path, IntPtr context, ref Guid iid, out ShellItem item);

  public static string Select(IntPtr owner, string title, string initialDirectory) {
    var dialog = (FileDialog)new FileOpenDialog();
    try {
      dialog.SetTitle(title);
      uint options;
      dialog.GetOptions(out options);
      dialog.SetOptions(options | PickFolders | ForceFileSystem | PathMustExist);
      if (!String.IsNullOrEmpty(initialDirectory)) {
        Guid itemId = typeof(ShellItem).GUID;
        ShellItem folder;
        if (SHCreateItemFromParsingName(initialDirectory, IntPtr.Zero, ref itemId, out folder) >= 0) {
          try { dialog.SetFolder(folder); }
          finally { Marshal.ReleaseComObject(folder); }
        }
      }

      int status = dialog.Show(owner);
      if (status == Cancelled) return null;
      Marshal.ThrowExceptionForHR(status);
      ShellItem selection;
      dialog.GetResult(out selection);
      try {
        string path;
        selection.GetDisplayName(FileSystemPath, out path);
        return path;
      } finally { Marshal.ReleaseComObject(selection); }
    } finally { Marshal.ReleaseComObject(dialog); }
  }
}

public static class WindowsPicker {
  public static void Run() {
    Console.OutputEncoding = new UTF8Encoding(false);
    Console.WriteLine("ready");
    string request;
    while ((request = Console.ReadLine()) != null) {
      try {
        var fields = request.Split('\t');
        var title = ReadField(fields[0]);
        var filter = ReadField(fields[1]);
        var directory = ReadField(fields[2]);
        var selection = Choose(title, filter, directory);
        Console.WriteLine(selection == null ? "cancelled" : "ok:" + Convert.ToBase64String(Encoding.UTF8.GetBytes(selection)));
      } catch (Exception) {
        Console.WriteLine("error");
      }
    }
  }

  private static string ReadField(string field) {
    return Encoding.UTF8.GetString(Convert.FromBase64String(field));
  }

  private static string Choose(string title, string filter, string directory) {
    using (var owner = new PickerOwner())
    using (var activation = new PickerActivation((uint)System.Diagnostics.Process.GetCurrentProcess().Id)) {
      if (String.IsNullOrEmpty(filter)) return PickerFolder.Select(owner.Handle, title, directory);
      using (var dialog = new OpenFileDialog {
        Title = title, Filter = filter, InitialDirectory = directory,
        CheckFileExists = true, Multiselect = false, RestoreDirectory = true
      }) {
        return dialog.ShowDialog(owner) == DialogResult.OK ? dialog.FileName : null;
      }
    }
  }
}
