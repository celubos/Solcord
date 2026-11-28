// SPDX-License-Identifier: Apache-2.0

using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;

namespace Solcord.Installer;

/// <summary>Fonts and shapes shared by Setup's window.</summary>
internal static class InstallerTheme
{
    private static readonly Lazy<HashSet<string>> InstalledFamilies = new(() => new HashSet<string>(FontFamily.Families.Select(family => family.Name), StringComparer.OrdinalIgnoreCase));

    /// <summary>Segoe UI Variable on Windows 11, Segoe UI elsewhere (never the GDI fallback font).</summary>
    internal static Font UiFont(float size, FontStyle style = FontStyle.Regular, bool display = false)
    {
        string preferred = display ? "Segoe UI Variable Display" : "Segoe UI Variable Text";
        string family = InstalledFamilies.Value.Contains(preferred) ? preferred : "Segoe UI";
        return new Font(family, size, style);
    }

    /// <summary>The icon font for status glyphs, or null when neither Windows icon font is installed.</summary>
    internal static string? IconFontFamily =>
        InstalledFamilies.Value.Contains("Segoe Fluent Icons") ? "Segoe Fluent Icons"
        : InstalledFamilies.Value.Contains("Segoe MDL2 Assets") ? "Segoe MDL2 Assets"
        : null;

    internal static GraphicsPath RoundedRectangle(RectangleF bounds, float radius)
    {
        float diameter = Math.Max(0.1f, Math.Min(radius * 2, Math.Min(bounds.Width, bounds.Height)));
        var path = new GraphicsPath();
        path.AddArc(bounds.Left, bounds.Top, diameter, diameter, 180, 90);
        path.AddArc(bounds.Right - diameter, bounds.Top, diameter, diameter, 270, 90);
        path.AddArc(bounds.Right - diameter, bounds.Bottom - diameter, diameter, diameter, 0, 90);
        path.AddArc(bounds.Left, bounds.Bottom - diameter, diameter, diameter, 90, 90);
        path.CloseFigure();
        return path;
    }
}

/// <summary>A flat button with rounded corners and hover, pressed, disabled, and focus states.</summary>
internal sealed class RoundedButton : Button
{
    private bool _hover;
    private bool _pressed;

    /// <summary>The colour behind the rounded corners; empty uses the nearest opaque parent.</summary>
    internal Color CornerColor {get; set;} = Color.Empty;

    internal RoundedButton()
    {
        SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw | ControlStyles.UserPaint, true);
    }

    protected override void OnMouseEnter(EventArgs e) {_hover = true; Invalidate(); base.OnMouseEnter(e);}
    protected override void OnMouseLeave(EventArgs e) {_hover = false; _pressed = false; Invalidate(); base.OnMouseLeave(e);}
    protected override void OnMouseDown(MouseEventArgs mevent) {if (mevent.Button == MouseButtons.Left) {_pressed = true; Invalidate();} base.OnMouseDown(mevent);}
    protected override void OnMouseUp(MouseEventArgs mevent) {_pressed = false; Invalidate(); base.OnMouseUp(mevent);}
    protected override void OnEnabledChanged(EventArgs e) {_hover = false; _pressed = false; Invalidate(); base.OnEnabledChanged(e);}

    protected override void OnPaint(PaintEventArgs pevent)
    {
        Graphics graphics = pevent.Graphics;
        graphics.Clear(ResolveCornerColor());
        graphics.SmoothingMode = SmoothingMode.AntiAlias;
        float scale = DeviceDpi / 96f;
        Color fill = !Enabled ? BackColor
            : _pressed && !FlatAppearance.MouseDownBackColor.IsEmpty ? FlatAppearance.MouseDownBackColor
            : _hover && !FlatAppearance.MouseOverBackColor.IsEmpty ? FlatAppearance.MouseOverBackColor
            : BackColor;
        var bounds = new RectangleF(0.5f, 0.5f, Width - 1.5f, Height - 1.5f);
        using (GraphicsPath shape = InstallerTheme.RoundedRectangle(bounds, 7 * scale))
        {
            using var brush = new SolidBrush(fill);
            graphics.FillPath(brush, shape);
            using var border = new Pen(FlatAppearance.BorderColor.IsEmpty ? fill : FlatAppearance.BorderColor, Math.Max(1f, scale));
            graphics.DrawPath(border, shape);
        }
        if (Focused && ShowFocusCues)
        {
            float inset = 3 * scale;
            using GraphicsPath ring = InstallerTheme.RoundedRectangle(new RectangleF(inset, inset, Width - 1 - inset * 2, Height - 1 - inset * 2), 5 * scale);
            using var pen = new Pen(ForeColor, Math.Max(1f, scale)) {DashStyle = DashStyle.Dot};
            graphics.DrawPath(pen, ring);
        }
        TextRenderer.DrawText(graphics, Text, Font, ClientRectangle, ForeColor, fill, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine | TextFormatFlags.EndEllipsis | TextFormatFlags.NoPrefix);
    }

    private Color ResolveCornerColor()
    {
        if (!CornerColor.IsEmpty) return CornerColor;
        for (Control? parent = Parent; parent is not null; parent = parent.Parent)
            if (parent.BackColor.A == 255) return parent.BackColor;
        return SystemColors.Control;
    }
}

/// <summary>Matches the Windows 11 title bar to Setup's header. Older Windows ignores it.</summary>
internal static class WindowChrome
{
    private const int DwmUseImmersiveDarkMode = 20;
    private const int DwmCaptionColor = 35;
    private const int DwmTextColor = 36;

    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(IntPtr window, int attribute, ref int value, int size);

    internal static void Apply(Form form, Color caption, Color text)
    {
        try
        {
            int dark = 1;
            DwmSetWindowAttribute(form.Handle, DwmUseImmersiveDarkMode, ref dark, sizeof(int));
            int captionColor = ColorTranslator.ToWin32(caption);
            DwmSetWindowAttribute(form.Handle, DwmCaptionColor, ref captionColor, sizeof(int));
            int textColor = ColorTranslator.ToWin32(text);
            DwmSetWindowAttribute(form.Handle, DwmTextColor, ref textColor, sizeof(int));
        }
        catch (Exception error) when (error is DllNotFoundException or EntryPointNotFoundException) {/* Not available: keep the default title bar. */}
    }
}
