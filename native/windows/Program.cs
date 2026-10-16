using System.Speech.Recognition;
using System.Text;
using System.Text.Json;
using Windows.Graphics.Imaging;
using Windows.Media.Ocr;
using Windows.Storage;
using Windows.Security.Credentials.UI;

internal static class Program
{
    private static readonly object OutputLock = new();
    private static void Emit(object value) { lock (OutputLock) Console.WriteLine(JsonSerializer.Serialize(value)); }
    private static int Error(string code, string message) { Emit(new { error = new { code, message } }); return 2; }
    private static string Locale(string[] args) { var i = Array.IndexOf(args, "--locale"); return i >= 0 && i + 1 < args.Length ? args[i + 1] : "en-US"; }
    public static async Task<int> Main(string[] args)
    {
        Console.InputEncoding = Encoding.UTF8; Console.OutputEncoding = new UTF8Encoding(false);
        try
        {
            switch (args.FirstOrDefault())
            {
                case "version": Emit(new { version = 1, name = "workspace-native", platform = "win32" }); return 0;
                case "ocr": return await Ocr();
                case "dictation": return await Dictation(args);
                case "biometric": return await Biometric(args);
                default: return Error("NATIVE_UNSUPPORTED", "This integration is not supported by Windows. Use the app’s local tasks and calendar instead.");
            }
        }
        catch (UnauthorizedAccessException) { return Error("ACCESS_DENIED", "Windows denied access. Check the app's device permissions in Windows Settings."); }
        catch (Exception e) { return Error("NATIVE_HELPER_FAILED", e.Message); }
    }
    private static async Task<int> Ocr()
    {
        using var input = JsonDocument.Parse(await Console.In.ReadToEndAsync());
        var file = input.RootElement.GetProperty("file").GetString();
        if (file is null || !Path.IsPathFullyQualified(file)) return Error("INVALID_INPUT", "An absolute image path is required.");
        var engine = OcrEngine.TryCreateFromUserProfileLanguages();
        if (engine is null) return Error("OCR_LANGUAGE_UNAVAILABLE", "Install an OCR language in Windows Settings → Time & language → Language & region.");
        using var stream = await (await StorageFile.GetFileFromPathAsync(file)).OpenReadAsync();
        var decoder = await BitmapDecoder.CreateAsync(stream);
        var transform = new BitmapTransform();
        var maximum = OcrEngine.MaxImageDimension;
        if (decoder.PixelWidth > maximum || decoder.PixelHeight > maximum)
        {
            var scale = Math.Min((double)maximum / decoder.PixelWidth, (double)maximum / decoder.PixelHeight);
            transform.ScaledWidth = Math.Max(1, (uint)(decoder.PixelWidth * scale));
            transform.ScaledHeight = Math.Max(1, (uint)(decoder.PixelHeight * scale));
        }
        using var bitmap = await decoder.GetSoftwareBitmapAsync(BitmapPixelFormat.Bgra8, BitmapAlphaMode.Premultiplied, transform, ExifOrientationMode.RespectExifOrientation, ColorManagementMode.DoNotColorManage);
        var result = await engine.RecognizeAsync(bitmap);
        Emit(new { text = string.Join("\n", result.Lines.Select(line => line.Text)) });
        return 0;
    }
    private static async Task<int> Dictation(string[] args)
    {
        var locale = Locale(args);
        if (locale != "en-US" && locale != "pt-BR") return Error("UNSUPPORTED_LOCALE", "Unsupported dictation language.");
        var info = SpeechRecognitionEngine.InstalledRecognizers().FirstOrDefault(r => string.Equals(r.Culture.Name, locale, StringComparison.OrdinalIgnoreCase));
        if (args.ElementAtOrDefault(1) == "status")
        {
            Emit(new { available = info is not null, recognizer = info is not null, onDevice = info is not null, speech = info is null ? "unavailable" : "authorized", microphone = "notDetermined", locale });
            return 0;
        }
        if (args.ElementAtOrDefault(1) != "start") return Error("UNKNOWN_COMMAND", "Use dictation status|start.");
        if (info is null) return Error("ON_DEVICE_UNAVAILABLE", $"Install the offline Windows speech recognizer for {locale} in Windows Settings. No audio was uploaded.");
        using var engine = new SpeechRecognitionEngine(info);
        engine.LoadGrammar(new DictationGrammar());
        engine.SetInputToDefaultAudioDevice();
        var completed = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var segment = 0;
        engine.SpeechHypothesized += (_, e) => Emit(new { type = "partial", text = e.Result.Text, segment });
        engine.SpeechRecognized += (_, e) => { Emit(new { type = "final", text = e.Result.Text, segment }); segment++; };
        engine.AudioLevelUpdated += (_, e) => Emit(new { type = "level", value = e.AudioLevel / 100.0 });
        engine.RecognizeCompleted += (_, e) => { if (e.Error is not null) Emit(new { type = "error", code = "RECOGNITION_FAILED", message = e.Error.Message }); completed.TrySetResult(); };
        engine.RecognizeAsync(RecognizeMode.Multiple);
        Emit(new { type = "ready", locale, onDevice = true });
        var command = await Task.WhenAny(Console.In.ReadLineAsync(CancellationToken.None).AsTask(), Task.Delay(TimeSpan.FromMinutes(30)));
        engine.RecognizeAsyncStop();
        await Task.WhenAny(completed.Task, Task.Delay(3000));
        Emit(new { type = "end" });
        return 0;
    }
    private static async Task<int> Biometric(string[] args)
    {
        var available = await UserConsentVerifier.CheckAvailabilityAsync();
        if (args.ElementAtOrDefault(1) == "status") { Emit(new { available = available == UserConsentVerifierAvailability.Available }); return 0; }
        if (available != UserConsentVerifierAvailability.Available) return Error("BIOMETRIC_UNAVAILABLE", "Windows Hello is not available for this user.");
        using var input = JsonDocument.Parse(await Console.In.ReadToEndAsync());
        var hwnd = (nint)input.RootElement.GetProperty("window").GetInt64();
        var message = input.RootElement.GetProperty("message").GetString() ?? "Unlock workspace";
        var result = await UserConsentVerifierInterop.RequestVerificationForWindowAsync(hwnd, message);
        if (result != UserConsentVerificationResult.Verified) return Error("BIOMETRIC_REJECTED", "Windows Hello verification was cancelled or rejected.");
        Emit(new { verified = true }); return 0;
    }
}
