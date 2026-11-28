// SPDX-License-Identifier: Apache-2.0

using System.Reflection;
using System.Text.RegularExpressions;

namespace Solcord.Installer;

/// <summary>How Setup was opened: by hand, from the Start Menu "Solcord" entry (--launch), or from Settings &gt; Apps (--uninstall).</summary>
internal enum InstallerStartup {Normal, Heal, Uninstall}

internal sealed class InstallerForm : Form
{
    private static readonly Color Canvas = Color.FromArgb(247, 245, 240);
    private static readonly Color Surface = Color.FromArgb(255, 255, 253);
    private static readonly Color BrandTile = Color.FromArgb(24, 37, 39);
    private static readonly Color Ink = Color.FromArgb(23, 29, 31);
    private static readonly Color Body = Color.FromArgb(55, 66, 69);
    private static readonly Color Muted = Color.FromArgb(91, 105, 108);
    private static readonly Color Line = Color.FromArgb(198, 205, 201);
    private static readonly Color Teal = Color.FromArgb(13, 107, 99);
    private static readonly Color TealHover = Color.FromArgb(9, 84, 78);
    private static readonly Color TealWash = Color.FromArgb(227, 242, 238);
    private static readonly Color Warning = Color.FromArgb(128, 75, 8);
    private static readonly Color WarningWash = Color.FromArgb(255, 241, 214);
    private static readonly Color Danger = Color.FromArgb(145, 42, 42);
    private static readonly Color DangerWash = Color.FromArgb(252, 236, 232);
    private static readonly Color Disabled = Color.FromArgb(229, 232, 228);
    private static readonly Color DisabledInk = Color.FromArgb(92, 102, 100);

    private readonly InstallerEngine _engine;
    private readonly ReleaseManifest _manifest;
    private readonly SetupRegistration? _registration;
    private InstallerStartup _startup;
    private bool _discordUpdatedState;
    private readonly ComboBox _targets = new();
    private readonly Label _stateKind = new();
    private readonly Label _stateTitle = new();
    private readonly Label _stateBody = new();
    private readonly Panel _statePanel = new();
    private readonly Button _primaryAction;
    // "Check files" and the backups folder are rows in the options list; these point at their buttons.
    private Button _verifyAction = null!;
    private Button _recoveryAction = null!;
    private readonly Button _refreshTargetsAction;
    private readonly Button _closeAction;
    private readonly Button _errorDetailsAction;
    private readonly Label _maintenanceHeading = new();
    private readonly Label _installNotes = new();
    private readonly TableLayoutPanel _maintenanceList = new();
    private readonly TableLayoutPanel _workspace = new();
    private readonly Panel _header = new();
    private readonly Panel _workspaceScroll = new();
    private readonly Panel _footer = new();
    private readonly Panel _brandMarkHost = new();
    private readonly PictureBox _brandMark = new();
    private readonly Panel _primaryRow = new();
    private readonly Dictionary<string, ActionVisual> _actions = new(StringComparer.Ordinal);
    private string? _recommendedKey;
    private bool _busy;
    private bool _checkingState;
    private bool _refreshingTargets;
    private bool _canVerify;
    private bool _canOpenRecovery;
    private string? _errorDetails;
    private int _stateGeneration;
    private Color _stateBorder = Color.FromArgb(118, 171, 163);

    /// <param name="registration">The persistent Setup copy and Settings &gt; Apps entry; null in self-tests so they never touch the real PC.</param>
    internal InstallerForm(string bundleRoot, InstallerEngine? engine = null, InstallerStartup startup = InstallerStartup.Normal, SetupRegistration? registration = null)
    {
        _engine = engine ?? new InstallerEngine(bundleRoot, Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData));
        _manifest = _engine.LoadManifest();
        _registration = registration;
        _startup = startup;
        if (registration is not null) _engine.SetupExecutable = registration.SetupExecutable;
        _primaryAction = NewButton("Continue", ButtonTone.Primary);
        _refreshTargetsAction = NewButton("Refresh", ButtonTone.Outline);
        _closeAction = NewButton("Close", ButtonTone.Outline);
        _errorDetailsAction = NewButton("Error details", ButtonTone.Outline);

        Text = $"Solcord Setup · {_manifest.CandidateLabel}";
        ClientSize = new Size(900, 650);
        MinimumSize = new Size(760, 600);
        StartPosition = FormStartPosition.CenterScreen;
        AutoScaleMode = AutoScaleMode.Dpi;
        AutoScaleDimensions = new SizeF(96F, 96F);
        BackColor = Canvas;
        ForeColor = Ink;
        Font = new Font("Segoe UI Variable Text", 9.5f);
        Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        DoubleBuffered = true;

        Controls.Add(BuildShell());
        AcceptButton = _primaryAction;
        CancelButton = _closeAction;
        Load += async (_, _) => {await RefreshTargetsAsync(); await ContinueStartupAsync();};
        Shown += (_, _) => {if (_targets.Enabled) _targets.Focus();};
        _targets.SelectedIndexChanged += (_, _) => RefreshInstallationState();
        FormClosing += (_, e) => {if (_busy) e.Cancel = true;};
    }

    private Control BuildShell()
    {
        var shell = new TableLayoutPanel {Dock = DockStyle.Fill, BackColor = Canvas, ColumnCount = 1, RowCount = 3, Margin = Padding.Empty, Padding = Padding.Empty};
        shell.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        shell.RowStyles.Add(new RowStyle(SizeType.Absolute, 78));
        shell.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        shell.RowStyles.Add(new RowStyle(SizeType.Absolute, 48));
        shell.Controls.Add(BuildHeader(), 0, 0);
        shell.Controls.Add(BuildWorkspace(), 0, 1);
        shell.Controls.Add(BuildFooter(), 0, 2);
        return shell;
    }

    private Control BuildHeader()
    {
        _header.Name = "installerHeader";
        _header.Dock = DockStyle.Fill;
        _header.AutoSize = false;
        _header.Margin = Padding.Empty;
        _header.BackColor = Surface;
        _header.Padding = new Padding(36, 10, 36, 10);
        _header.Paint += (_, args) => {using var rule = new Pen(Line, 1); args.Graphics.DrawLine(rule, 0, _header.ClientSize.Height - 1, _header.ClientSize.Width, _header.ClientSize.Height - 1);};
        var layout = new TableLayoutPanel {Dock = DockStyle.Fill, ColumnCount = 2, RowCount = 1, BackColor = Color.Transparent, Margin = Padding.Empty, Padding = Padding.Empty};
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 56));
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        _brandMarkHost.Name = "brandMarkSafeArea";
        _brandMarkHost.Dock = DockStyle.Fill;
        _brandMarkHost.BackColor = BrandTile;
        _brandMarkHost.Margin = new Padding(4, 5, 4, 5);
        _brandMarkHost.Padding = new Padding(4);
        _brandMarkHost.MinimumSize = new Size(48, 48);
        _brandMark.Name = "brandMark";
        _brandMark.Dock = DockStyle.Fill;
        _brandMark.Margin = Padding.Empty;
        _brandMark.SizeMode = PictureBoxSizeMode.Zoom;
        _brandMark.BackColor = BrandTile;
        _brandMark.Image = LoadBrandMark();
        _brandMark.AccessibleName = "Solcord cord-cut S mark";
        _brandMark.TabStop = false;
        _brandMarkHost.Controls.Add(_brandMark);
        var copy = new TableLayoutPanel {Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 2, BackColor = Color.Transparent, Margin = Padding.Empty, Padding = Padding.Empty};
        copy.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        copy.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        copy.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        var title = NewLabel("Solcord Setup", 19f, FontStyle.Bold, Ink);
        title.Dock = DockStyle.Fill;
        title.AutoSize = true;
        title.TextAlign = ContentAlignment.BottomLeft;
        var subtitle = NewLabel($"Version {_manifest.CandidateLabel} · Adds Solcord to the Discord app on this PC.", 9.25f, FontStyle.Regular, Body);
        subtitle.Dock = DockStyle.Fill;
        subtitle.TextAlign = ContentAlignment.TopLeft;
        copy.Controls.Add(title, 0, 0);
        copy.Controls.Add(subtitle, 0, 1);
        layout.Controls.Add(_brandMarkHost, 0, 0);
        layout.Controls.Add(copy, 1, 0);
        _header.Controls.Add(layout);
        return _header;
    }

    private Control BuildWorkspace()
    {
        _workspaceScroll.Name = "installerWorkspaceScroll";
        _workspaceScroll.Dock = DockStyle.Fill;
        _workspaceScroll.Margin = Padding.Empty;
        _workspaceScroll.Padding = Padding.Empty;
        _workspaceScroll.BackColor = Canvas;
        _workspaceScroll.AutoScroll = true;
        _workspace.AutoSize = true;
        _workspace.AutoSizeMode = AutoSizeMode.GrowAndShrink;
        _workspace.Dock = DockStyle.Top;
        _workspace.BackColor = Canvas;
        _workspace.ColumnCount = 1;
        _workspace.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        _workspace.RowCount = 7;
        _workspace.Padding = new Padding(36, 12, 36, 12);
        _workspace.Margin = Padding.Empty;
        for (int i = 0; i < _workspace.RowCount; i++) _workspace.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        _workspace.Controls.Add(BuildTargetField(), 0, 0);
        _workspace.Controls.Add(BuildStatePanel(), 0, 1);
        _workspace.Controls.Add(BuildPrimaryAction(), 0, 2);
        _workspace.Controls.Add(BuildInstallNotes(), 0, 3);
        _workspace.Controls.Add(BuildMaintenanceHeader(), 0, 4);
        _workspace.Controls.Add(BuildMaintenanceList(), 0, 5);
        _workspace.Controls.Add(BuildUtilities(), 0, 6);
        _workspaceScroll.Controls.Add(_workspace);
        return _workspaceScroll;
    }

    private Control BuildTargetField()
    {
        var field = new TableLayoutPanel {Dock = DockStyle.Top, AutoSize = true, MinimumSize = new Size(0, 40), ColumnCount = 3, RowCount = 1, BackColor = Canvas, Margin = new Padding(0, 0, 0, 8), Padding = Padding.Empty};
        field.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 136));
        field.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        field.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 112));
        field.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        var label = NewLabel("Discord app", 9.5f, FontStyle.Bold, Ink);
        label.Dock = DockStyle.Fill;
        label.TextAlign = ContentAlignment.MiddleLeft;
        _targets.DropDownStyle = ComboBoxStyle.DropDownList;
        _targets.FormattingEnabled = true;
        _targets.Dock = DockStyle.Fill;
        _targets.Margin = new Padding(0, 5, 8, 5);
        _targets.BackColor = Surface;
        _targets.ForeColor = Ink;
        _targets.FlatStyle = FlatStyle.Flat;
        _targets.TabIndex = 0;
        _targets.AccessibleName = "Discord app and version";
        _targets.AccessibleDescription = "Choose an installed Stable, PTB, or Canary version.";
        _targets.Format += (_, eventArgs) => {if (eventArgs.ListItem is DiscordTarget target) eventArgs.Value = $"{target.Channel} · {target.Version}";};
        _refreshTargetsAction.Dock = DockStyle.Fill;
        _refreshTargetsAction.Margin = new Padding(0, 2, 0, 2);
        _refreshTargetsAction.TabIndex = 1;
        _refreshTargetsAction.AccessibleName = "Refresh installed Discord versions";
        _refreshTargetsAction.AccessibleDescription = "Check for installed Stable, PTB, or Canary versions. Keyboard shortcut: F5.";
        _refreshTargetsAction.Click += async (_, _) => await RefreshTargetsAsync();
        field.Controls.Add(label, 0, 0);
        field.Controls.Add(_targets, 1, 0);
        field.Controls.Add(_refreshTargetsAction, 2, 0);
        return field;
    }

    private Control BuildStatePanel()
    {
        _statePanel.Dock = DockStyle.Top;
        _statePanel.AutoSize = true;
        _statePanel.MinimumSize = new Size(0, 76);
        _statePanel.Margin = new Padding(0, 0, 0, 8);
        _statePanel.Padding = new Padding(18, 8, 16, 8);
        _statePanel.BackColor = TealWash;
        _statePanel.Paint += (_, args) => {
            using var accent = new SolidBrush(_stateBorder);
            using var rule = new Pen(Color.FromArgb(186, 199, 195), 1);
            args.Graphics.FillRectangle(accent, 0, 0, 4, _statePanel.ClientSize.Height);
            args.Graphics.DrawLine(rule, 4, _statePanel.ClientSize.Height - 1, _statePanel.ClientSize.Width, _statePanel.ClientSize.Height - 1);
        };
        var copy = new TableLayoutPanel {Dock = DockStyle.Fill, AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink, ColumnCount = 1, RowCount = 3, BackColor = Color.Transparent, Margin = Padding.Empty, Padding = Padding.Empty};
        copy.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        copy.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        copy.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        copy.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        _stateKind.Dock = DockStyle.Fill;
        _stateKind.AutoSize = true;
        _stateKind.Margin = new Padding(3, 0, 3, 0);
        _stateKind.Font = new Font("Segoe UI Variable Text", 9f, FontStyle.Bold);
        _stateKind.ForeColor = Teal;
        _stateTitle.Dock = DockStyle.Fill;
        _stateTitle.AutoSize = true;
        _stateTitle.Margin = new Padding(3, 0, 3, 0);
        _stateTitle.Font = new Font("Segoe UI Variable Text", 14f, FontStyle.Bold);
        _stateTitle.ForeColor = Ink;
        _stateBody.Dock = DockStyle.Fill;
        _stateBody.Margin = new Padding(3, 0, 3, 0);
        _stateBody.Font = new Font("Segoe UI Variable Text", 9.25f, FontStyle.Regular);
        _stateBody.ForeColor = Body;
        _stateBody.AutoSize = true;
        _stateBody.AutoEllipsis = false;
        _statePanel.SizeChanged += (_, _) => {
            int width = Math.Max(160, _statePanel.ClientSize.Width - _statePanel.Padding.Horizontal);
            if (_stateBody.MaximumSize.Width != width) _stateBody.MaximumSize = new Size(width, 0);
        };
        copy.Controls.Add(_stateKind, 0, 0);
        copy.Controls.Add(_stateTitle, 0, 1);
        copy.Controls.Add(_stateBody, 0, 2);
        _statePanel.Controls.Add(copy);
        return _statePanel;
    }

    private Control BuildPrimaryAction()
    {
        _primaryRow.Dock = DockStyle.Top;
        _primaryRow.AutoSize = false;
        _primaryRow.Height = 46;
        _primaryRow.BackColor = Canvas;
        _primaryRow.Padding = new Padding(0, 0, 0, 10);
        _primaryAction.Dock = DockStyle.None;
        _primaryAction.Anchor = AnchorStyles.Top | AnchorStyles.Left;
        _primaryAction.Size = new Size(224, 36);
        _primaryAction.Location = Point.Empty;
        _primaryAction.TabIndex = 1;
        _primaryAction.Click += (_, _) => {if (_recommendedKey is not null) RunOperation(_recommendedKey);};
        _primaryRow.Controls.Add(_primaryAction);
        return _primaryRow;
    }

    /// <summary>Three short reassurances shown only before a first install.</summary>
    private Control BuildInstallNotes()
    {
        _installNotes.Name = "installNotes";
        _installNotes.Dock = DockStyle.Top;
        _installNotes.AutoSize = true;
        _installNotes.Margin = new Padding(3, 0, 3, 8);
        _installNotes.Font = new Font("Segoe UI Variable Text", 9.25f, FontStyle.Regular);
        _installNotes.ForeColor = Body;
        _installNotes.BackColor = Color.Transparent;
        _installNotes.UseMnemonic = false;
        _installNotes.Text = "✓  Takes about a minute. If Discord is open, it closes for a moment.\n✓  Your Discord login, plugins, themes, and settings stay as they are.\n✓  Undo it any time with Uninstall, here or in Settings › Apps.";
        _installNotes.AccessibleName = "What installing does";
        _installNotes.Visible = false;
        _workspace.SizeChanged += (_, _) => {
            int width = Math.Max(160, _workspace.ClientSize.Width - _workspace.Padding.Horizontal - 6);
            if (_installNotes.MaximumSize.Width != width) _installNotes.MaximumSize = new Size(width, 0);
        };
        return _installNotes;
    }

    private Control BuildMaintenanceHeader()
    {
        var header = new TableLayoutPanel {Dock = DockStyle.Top, AutoSize = true, MinimumSize = new Size(0, 30), ColumnCount = 1, RowCount = 1, BackColor = Canvas, Margin = Padding.Empty, Padding = Padding.Empty};
        header.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        _maintenanceHeading.Text = "More options";
        _maintenanceHeading.Font = new Font("Segoe UI Variable Text", 11f, FontStyle.Bold);
        _maintenanceHeading.ForeColor = Ink;
        _maintenanceHeading.Dock = DockStyle.Fill;
        _maintenanceHeading.TextAlign = ContentAlignment.MiddleLeft;
        header.Controls.Add(_maintenanceHeading, 0, 0);
        return header;
    }

    private Control BuildMaintenanceList()
    {
        _maintenanceList.Dock = DockStyle.Top;
        _maintenanceList.AutoSize = true;
        _maintenanceList.AutoSizeMode = AutoSizeMode.GrowAndShrink;
        _maintenanceList.ColumnCount = 1;
        _maintenanceList.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        _maintenanceList.RowCount = 5;
        _maintenanceList.BackColor = Surface;
        _maintenanceList.Margin = Padding.Empty;
        _maintenanceList.Padding = Padding.Empty;
        for (int i = 0; i < 5; i++) _maintenanceList.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        _maintenanceList.Controls.Add(ActionRow("repair", "Repair Solcord", "Put back this version's files if something is missing or changed.", 2, 0), 0, 0);
        _maintenanceList.Controls.Add(ActionRow("rollback", "Roll back", "Undo the last change using the backup made before it.", 3, 1), 0, 1);
        _maintenanceList.Controls.Add(ActionRow("verify", "Check files", "Compare the installed files with this version. Nothing is changed.", 4, 2, buttonText: "Check", onClick: CheckFiles), 0, 2);
        _maintenanceList.Controls.Add(ActionRow("backups", "Backups", "Open the folder with the backup Setup makes before every change.", 5, 3, buttonText: "Open", buttonAccessibleName: "Open backups folder", onClick: OpenBackups), 0, 3);
        _maintenanceList.Controls.Add(ActionRow("uninstall", "Uninstall Solcord", "Return Discord to normal. Plugins, themes, and settings stay on disk.", 6, 4, ButtonTone.Danger), 0, 4);
        _verifyAction = _actions["verify"].Button;
        _recoveryAction = _actions["backups"].Button;
        return _maintenanceList;
    }

    private void CheckFiles()
    {
        DiscordTarget selected = Target();
        RunAction("Checking files", () => _engine.VerifyInstalled(selected) ? $"All Solcord files match {_manifest.CandidateLabel} for Discord {selected.Channel} {selected.Version}. Nothing was changed." : $"Some Solcord files differ from {_manifest.CandidateLabel} for Discord {selected.Channel} {selected.Version}. Repair puts them back. Nothing was changed.");
    }

    private void OpenBackups() => RunAction("Opening backups", () => {
        System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(_engine.RecoveryDirectory) {UseShellExecute = true});
        return "Opened the folder with Solcord's backups.";
    });

    private Control ActionRow(string key, string title, string description, int tabIndex, int rowIndex, ButtonTone tone = ButtonTone.Outline, string? buttonText = null, string? buttonAccessibleName = null, Action? onClick = null)
    {
        var row = new Panel {Dock = DockStyle.Fill, AutoSize = false, Height = 48, MinimumSize = new Size(0, 44), BackColor = Surface, Margin = Padding.Empty, Padding = Padding.Empty, AccessibleName = title};
        // A divider separates this row from the next visible one, never below the last.
        row.Paint += (_, args) => {if (_actions.Values.Any(action => action.RowIndex > rowIndex && action.Row.Visible)) {using var rule = new Pen(Line, 1); args.Graphics.DrawLine(rule, 18, row.ClientSize.Height - 1, row.ClientSize.Width - 14, row.ClientSize.Height - 1);}};
        var copy = new TableLayoutPanel {ColumnCount = 1, RowCount = 2, BackColor = Color.Transparent, Margin = Padding.Empty, Padding = Padding.Empty};
        copy.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        copy.RowStyles.Add(new RowStyle(SizeType.Absolute, 19));
        copy.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        var name = NewLabel(title, 9.5f, FontStyle.Bold, Ink);
        name.Dock = DockStyle.Fill;
        var details = NewLabel(description, 8.5f, FontStyle.Regular, Body);
        details.Dock = DockStyle.Fill;
        details.AutoEllipsis = true;
        copy.Controls.Add(name, 0, 0);
        copy.Controls.Add(details, 0, 1);
        var button = NewButton(buttonText ?? title.Replace("Solcord", "").Trim(), tone);
        button.Anchor = AnchorStyles.Top | AnchorStyles.Right;
        button.AutoSize = false;
        button.Size = new Size(112, 36);
        button.Margin = Padding.Empty;
        button.TextAlign = ContentAlignment.MiddleCenter;
        button.TabIndex = tabIndex;
        button.AccessibleName = buttonAccessibleName ?? title;
        button.AccessibleDescription = description;
        button.Click += (_, _) => {if (onClick is not null) onClick(); else RunOperation(key);};
        row.Controls.Add(copy);
        row.Controls.Add(button);
        void ArrangeRow()
        {
            float scale = button.Width / 112F;
            int right = (int)Math.Round(14 * scale);
            int left = (int)Math.Round(16 * scale);
            int top = (int)Math.Round(4 * scale);
            int buttonTop = Math.Max(0, (row.ClientSize.Height - button.Height) / 2);
            button.Location = new Point(Math.Max(left, row.ClientSize.Width - right - button.Width), buttonTop);
            int copyWidth = Math.Max((int)Math.Round(120 * scale), button.Left - left - right);
            copy.Bounds = new Rectangle(left, top, copyWidth, Math.Max(1, row.ClientSize.Height - top * 2));
        }
        row.SizeChanged += (_, _) => ArrangeRow();
        button.SizeChanged += (_, _) => ArrangeRow();
        _actions[key] = new ActionVisual(title, description, row, button, tone, rowIndex);
        return row;
    }

    private Control BuildUtilities()
    {
        var utilities = new TableLayoutPanel {Dock = DockStyle.Top, AutoSize = true, ColumnCount = 1, RowCount = 1, BackColor = Canvas, Margin = Padding.Empty, Padding = new Padding(0, 8, 0, 0)};
        utilities.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        _errorDetailsAction.Dock = DockStyle.Left;
        _errorDetailsAction.AutoSize = true;
        _errorDetailsAction.Margin = Padding.Empty;
        _errorDetailsAction.TabIndex = 7;
        _errorDetailsAction.AccessibleName = "Read error details";
        _errorDetailsAction.AccessibleDescription = "Read the full error and affected local paths. No report is sent.";
        _errorDetailsAction.Visible = false;
        _errorDetailsAction.Click += (_, _) => {
            if (_errorDetails is null) return;
            using Form details = CreateErrorDetailsDialog(_errorDetails);
            details.ShowDialog(this);
        };
        utilities.Controls.Add(_errorDetailsAction, 0, 0);
        return utilities;
    }

    private Control BuildFooter()
    {
        _footer.Name = "installerFooter";
        _footer.Dock = DockStyle.Fill;
        _footer.AutoSize = false;
        _footer.Margin = Padding.Empty;
        _footer.BackColor = Surface;
        _footer.Padding = new Padding(36, 6, 24, 6);
        _footer.Paint += (_, args) => {using var rule = new Pen(Line, 1); args.Graphics.DrawLine(rule, 0, 0, _footer.ClientSize.Width, 0);};
        var layout = new TableLayoutPanel {Dock = DockStyle.Fill, ColumnCount = 2, RowCount = 1, BackColor = Color.Transparent, Margin = Padding.Empty, Padding = Padding.Empty};
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 96));
        var note = NewLabel("Built with BetterDiscord, created by @slaveofsolace.", 8.75f, FontStyle.Regular, Muted);
        note.Dock = DockStyle.Fill;
        note.TextAlign = ContentAlignment.MiddleLeft;
        _closeAction.Dock = DockStyle.Fill;
        _closeAction.Margin = Padding.Empty;
        _closeAction.TabIndex = 8;
        _closeAction.AccessibleName = "Close installer";
        _closeAction.Click += (_, _) => Close();
        layout.Controls.Add(note, 0, 0);
        layout.Controls.Add(_closeAction, 1, 0);
        _footer.Controls.Add(layout);
        return _footer;
    }

    protected override bool ProcessCmdKey(ref Message message, Keys keyData)
    {
        if (keyData == Keys.F5)
        {
            if (!_busy && !_refreshingTargets) _ = RefreshTargetsAsync();
            return true;
        }
        return base.ProcessCmdKey(ref message, keyData);
    }

    private IReadOnlyList<DiscordTarget> ReadDetectedTargets()
    {
        var targets = _engine.DetectTargets().ToList();
        try
        {
            DiscordTarget? managed = _engine.ManagedTarget();
            if (managed is not null && !targets.Any(target => target.Channel == managed.Channel && target.Version == managed.Version)) targets.Add(managed);
        }
        catch (Exception error) when (error is IOException or InvalidDataException or UnauthorizedAccessException) {/* Readiness errors are shown by the selected-target check. */}
        return targets;
    }

    private async Task RefreshTargetsAsync(Func<IReadOnlyList<DiscordTarget>>? detect = null, Func<DiscordTarget, InstallationState>? inspect = null)
    {
        if (_refreshingTargets) return;
        int generation = ++_stateGeneration;
        DiscordTarget? previous = _targets.SelectedItem as DiscordTarget;
        _refreshingTargets = true;
        _checkingState = true;
        SetErrorDetails(null);
        SetState("Checking", "Finding installed Discord versions", "Stable, PTB, and Canary can be refreshed without closing Setup.", StateTone.Protected, null);
        UpdateInteractionState();
        try
        {
            IReadOnlyList<DiscordTarget> targets = await Task.Run(detect ?? ReadDetectedTargets);
            if (IsDisposed || generation != _stateGeneration) return;
            _targets.BeginUpdate();
            try
            {
                _targets.Items.Clear();
                foreach (DiscordTarget target in targets) _targets.Items.Add(target);
                if (_targets.Items.Count > 0)
                {
                    int previousIndex = previous is null ? -1 : targets.ToList().FindIndex(target => target.Channel == previous.Channel && target.Version == previous.Version);
                    _targets.SelectedIndex = previousIndex >= 0 ? previousIndex : 0;
                }
            }
            finally {_targets.EndUpdate();}
            _refreshingTargets = false;
            if (_targets.Items.Count > 0) await RefreshInstallationStateAsync(inspect);
            else
            {
                SetActionAvailability(false, false, false, false, false);
                SetState("Discord not found", "Install Discord, then refresh", "Stable, PTB, or Canary was not detected on this PC. Install Discord or finish its update, then choose Refresh (F5).", StateTone.Warning, null);
            }
        }
        catch (Exception error)
        {
            if (IsDisposed || generation != _stateGeneration) return;
            if (InstalledPackageIsNewerSafe()) {ShowNewerInstalled(_engine.InstalledPackageLabel()); return;}
            SetActionAvailability(false, false, false, false, false);
            SetErrorDetails(error);
            SetState("Needs attention", "Discord versions couldn't be checked", $"{FriendlyError(error)} Refresh (F5) to try again.", StateTone.Danger, null);
        }
        finally
        {
            if (!IsDisposed)
            {
                if (generation == _stateGeneration) {_refreshingTargets = false; _checkingState = false;}
                UpdateInteractionState();
            }
        }
    }

    private async void RefreshInstallationState()
    {
        if (!_busy && !_refreshingTargets) await RefreshInstallationStateAsync();
    }

    private InstallationState ReadInstallationState(DiscordTarget selected)
    {
        // A newer Setup's records may not pass this Setup's strict checks; say so
        // plainly instead of reporting a validation failure.
        if (_engine.InstalledPackageIsNewer()) return new(false, true, true, false, false, null, _engine.InstalledPackageLabel(), NewerInstalled: true);
        bool pending = _engine.HasPendingRecovery();
        bool managed = _engine.HasManagedInstall();
        bool channelMatches = _engine.IsManagedChannel(selected);
        bool packageRecorded = managed && channelMatches && _engine.IsCurrentPackageRecorded();
        bool exact = !pending && packageRecorded && _engine.VerifyInstalled(selected);
        string? recordedVersion = managed && channelMatches ? _engine.RecordedDiscordVersion() : null;
        return new(pending, managed, channelMatches, packageRecorded, exact, recordedVersion, managed ? _engine.InstalledPackageLabel() : null);
    }

    private bool InstalledPackageIsNewerSafe()
    {
        try {return _engine.InstalledPackageIsNewer();}
        catch (Exception error) when (error is IOException or InvalidDataException or UnauthorizedAccessException) {return false;}
    }

    private void ShowNewerInstalled(string? installedLabel)
    {
        SetActionAvailability(false, false, false, false, false);
        SetState("Newer version installed", $"Solcord {installedLabel ?? "(newer)"} is already on this PC", $"This Setup is {_manifest.CandidateLabel}, which is older, so it won't change anything. Open \"Solcord Setup\" from the Start menu, or download the latest release, to manage Solcord.", StateTone.Warning, null);
    }

    private async Task RefreshInstallationStateAsync(Func<DiscordTarget, InstallationState>? inspect = null)
    {
        DiscordTarget? selected = _targets.SelectedItem as DiscordTarget;
        bool targetReady = selected is not null;
        if (!targetReady) {SetActionAvailability(false, false, false, false, false); return;}
        int generation = ++_stateGeneration;
        _checkingState = true;
        SetErrorDetails(null);
        _discordUpdatedState = false;
        SetState("Checking", $"Checking Discord {selected!.Channel}", $"Looking at version {selected.Version}. This takes a moment.", StateTone.Protected, null);
        UpdateInteractionState();
        try
        {
            var status = await Task.Run(() => (inspect ?? ReadInstallationState)(selected));
            if (IsDisposed || generation != _stateGeneration) return;
            if (status.NewerInstalled) {ShowNewerInstalled(status.InstalledLabel); return;}
            var (pending, managed, channelMatches, packageRecorded, exact, recordedVersion, installedLabel, _) = status;
            bool discordUpdated = managed && channelMatches && !pending && !exact && recordedVersion is not null && recordedVersion != selected.Version
                && Version.TryParse(recordedVersion, out Version? recorded) && Version.TryParse(selected.Version, out Version? chosen) && chosen > recorded;
            _discordUpdatedState = discordUpdated;
            if (managed && !channelMatches)
            {
                SetActionAvailability(false, false, false, false, false);
                string? recordedChannel = null;
                try {recordedChannel = _engine.RecordedChannel();}
                catch (Exception error) when (error is IOException or InvalidDataException or UnauthorizedAccessException) {}
                bool recordedPresent = recordedChannel is not null && _targets.Items.OfType<DiscordTarget>().Any(target => target.Channel == recordedChannel);
                if (recordedChannel is not null && !recordedPresent)
                    SetState("Different Discord app", $"Solcord is set up for Discord {recordedChannel}", $"Discord {recordedChannel} isn't installed right now. Reinstall it to remove Solcord there, or open the backups folder.", StateTone.Warning, null);
                else
                    SetState("Different Discord app", $"Choose Discord {recordedChannel ?? "the one Solcord uses"} above", "Solcord works with one Discord app at a time. Pick that one above; to switch apps, uninstall there first.", StateTone.Warning, null);
                return;
            }
            SetActionAvailability(targetReady, managed, exact, packageRecorded, pending);
            string installed = installedLabel is null ? "The installed version" : $"Solcord {installedLabel}";
            if (pending) SetState("Unfinished change", "Put things back the way they were", "A previous Setup run stopped partway. Restore its backup first. Your settings and add-ons are kept.", StateTone.Warning, "rollback", "Restore backup");
            else if (exact) SetState("Solcord is on", $"Solcord {_manifest.CandidateLabel} is installed", $"Everything checks out for Discord {selected.Channel} {selected.Version}. Open Discord to use it, or just close Setup.", StateTone.Protected, "launch");
            else if (discordUpdated && packageRecorded) SetState("Solcord is off", "Discord updated and turned Solcord off", $"Discord moved from {recordedVersion} to {selected.Version}. Turn Solcord back on to reconnect it. Settings and add-ons stay in place.", StateTone.Warning, "repair", "Turn Solcord back on");
            else if (discordUpdated) SetState("Solcord is off", "Discord updated and turned Solcord off", $"Discord moved from {recordedVersion} to {selected.Version}. Turning Solcord back on also updates it to {_manifest.CandidateLabel}. Settings and add-ons stay in place.", StateTone.Warning, "update", "Turn Solcord back on");
            else if (packageRecorded) SetState("Needs repair", "Some Solcord files changed", "Repair puts back this version's files. Settings and add-ons stay in place.", StateTone.Warning, "repair");
            else if (managed) SetState("Update available", $"Update Solcord to {_manifest.CandidateLabel}", $"{installed} is installed now. It's backed up first, so you can roll back.", StateTone.Warning, "update");
            else SetState("Ready to install", $"Install Solcord {_manifest.CandidateLabel}", $"Adds Solcord to Discord {selected.Channel} {selected.Version}.", StateTone.Protected, "install");
        }
        catch (Exception error)
        {
            if (IsDisposed || generation != _stateGeneration) return;
            if (InstalledPackageIsNewerSafe()) {ShowNewerInstalled(_engine.InstalledPackageLabel()); return;}
            SetActionAvailability(false, false, false, false, _engine.HasPendingRecovery());
            SetErrorDetails(error);
            SetState("Needs attention", "Setup couldn't read this installation", $"{FriendlyError(error)} Nothing was changed.", StateTone.Danger, _engine.HasPendingRecovery() ? "rollback" : null, _engine.HasPendingRecovery() ? "Restore backup" : null);
        }
        finally
        {
            if (!IsDisposed && generation == _stateGeneration) {_checkingState = false; UpdateInteractionState();}
        }
    }

    private void SetActionAvailability(bool targetReady, bool managed, bool exact, bool packageRecorded, bool pending)
    {
        SetManagedAction("repair", targetReady && packageRecorded && !pending);
        SetManagedAction("rollback", targetReady && (managed || pending));
        SetManagedAction("uninstall", targetReady && managed && !pending);
        _canVerify = targetReady && managed && !pending;
        _canOpenRecovery = Directory.Exists(_engine.RecoveryDirectory);
        SetManagedAction("verify", _canVerify);
        SetManagedAction("backups", _canOpenRecovery);
        bool anyMaintenance = _actions.Values.Any(action => action.Row.Visible);
        _maintenanceHeading.Visible = anyMaintenance;
        foreach (ActionVisual action in _actions.Values) action.Row.Invalidate();
        UpdateInteractionState();
    }

    private void SetManagedAction(string key, bool visible)
    {
        ActionVisual visual = _actions[key];
        visual.Row.Visible = visible;
        visual.Button.Enabled = visible && !_busy && !_checkingState && !_refreshingTargets;
        ApplyButtonTone(visual.Button, visual.Tone);
    }

    private void SetState(string kind, string title, string body, StateTone tone, string? recommendedKey, string? primaryLabel = null)
    {
        bool warning = tone == StateTone.Warning;
        bool danger = tone == StateTone.Danger;
        _stateKind.Text = kind;
        _stateKind.ForeColor = danger ? Danger : warning ? Warning : Teal;
        _stateTitle.Text = title;
        _stateBody.Text = body;
        _statePanel.BackColor = danger ? DangerWash : warning ? WarningWash : TealWash;
        _stateBorder = danger ? Danger : warning ? Warning : Color.FromArgb(118, 171, 163);
        _statePanel.Invalidate();
        _recommendedKey = recommendedKey;
        _primaryAction.Enabled = recommendedKey is not null && !_busy && !_checkingState && !_refreshingTargets;
        _primaryAction.Visible = recommendedKey is not null;
        _primaryRow.Visible = recommendedKey is not null;
        _primaryRow.Height = recommendedKey is null ? 0 : 46;
        _primaryAction.Text = primaryLabel ?? recommendedKey switch {"install" => "Install Solcord", "update" => "Update Solcord", "repair" => "Repair Solcord", "rollback" => "Roll back", "launch" => "Open Discord", _ => "Continue"};
        _primaryAction.AccessibleDescription = body;
        _installNotes.Visible = recommendedKey == "install";
        ApplyButtonTone(_primaryAction, ButtonTone.Primary);
    }

    private void UpdateInteractionState()
    {
        bool ready = !_busy && !_checkingState && !_refreshingTargets;
        _targets.Enabled = !_busy && !_refreshingTargets && _targets.Items.Count > 0;
        _refreshTargetsAction.Enabled = !_busy && !_refreshingTargets;
        _primaryAction.Enabled = ready && _recommendedKey is not null;
        foreach (ActionVisual action in _actions.Values) {action.Button.Enabled = ready && action.Row.Visible; ApplyButtonTone(action.Button, action.Tone);}
        _verifyAction.Enabled = ready && _canVerify;
        _recoveryAction.Enabled = ready && _canOpenRecovery;
        _errorDetailsAction.Enabled = !_busy && _errorDetails is not null;
        _closeAction.Enabled = !_busy;
        _closeAction.Text = _busy ? "Working…" : "Close";
        _closeAction.AccessibleName = _busy ? "Operation in progress" : "Close installer";
        _closeAction.AccessibleDescription = _busy ? "Setup can close when the current operation finishes." : "Close Setup. Keyboard shortcut: Escape.";
        foreach (Button button in new[] {_primaryAction, _verifyAction, _recoveryAction, _refreshTargetsAction, _errorDetailsAction, _closeAction}) ApplyButtonTone(button, button == _primaryAction ? ButtonTone.Primary : ButtonTone.Outline);
    }

    private DiscordTarget Target() => _targets.SelectedItem as DiscordTarget ?? throw new InvalidOperationException("Select an installed Discord channel first.");

    private string CompleteInstall(InstallReceipt receipt)
    {
        string result = $"Solcord {receipt.CandidateLabel ?? _manifest.CandidateLabel} is on for Discord {receipt.Channel} {receipt.DiscordVersion}. Open it any time as \"Solcord\" from the Start menu.";
        return WithNotes(result, _engine.LastLauncherWarning, UpdateSetupEntry());
    }

    private static string WithNotes(string result, params string?[] notes) => string.Join(" ", new[] {result}.Concat(notes.Where(note => note is not null))!);

    /// <summary>
    /// Keep the persistent "Solcord Setup" copy, its Start Menu entry, and the
    /// Settings &gt; Apps entry in step with the installation: present while Solcord
    /// is installed, gone after it is removed. Never fails the operation.
    /// </summary>
    private string? UpdateSetupEntry()
    {
        if (_registration is null) return null;
        string running = Environment.ProcessPath ?? Application.ExecutablePath;
        try
        {
            if (!_engine.HasManagedInstall()) {_registration.Remove(running); return null;}
            _registration.Ensure(running, _manifest);
            DiscordTarget? managed = _engine.ManagedTarget();
            if (managed is not null) _engine.RefreshLauncher(managed);
            return null;
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or InvalidDataException or InvalidOperationException or System.Security.SecurityException or PlatformNotSupportedException or System.Runtime.InteropServices.COMException)
        {
            return $"Solcord itself is fine, but the \"Solcord Setup\" entry in Start and Settings couldn't be updated ({error.GetType().Name}).";
        }
    }

    private void RunOperation(string key) => _ = RunOperationAsync(key, confirm: true);

    private async Task<bool> RunOperationAsync(string key, bool confirm)
    {
        if (_busy || _checkingState || _refreshingTargets) return false;
        DiscordTarget selected = Target();
        if (confirm && key == "uninstall" && MessageBox.Show("Remove Solcord from Discord?\n\nDiscord goes back to normal. Your plugins, themes, settings, and backups stay on this PC.", "Uninstall Solcord", MessageBoxButtons.YesNo, MessageBoxIcon.Warning, MessageBoxDefaultButton.Button2) != DialogResult.Yes) return false;
        if (key is "install" or "update" or "repair" or "rollback" or "uninstall")
        {
            IReadOnlyList<string> running = RunningDiscordChannelsSafe();
            if (running.Count > 0 && (!confirm || MessageBox.Show($"Discord {string.Join(", ", running)} is open. Setup needs to close it for a moment, which ends any call or upload in progress.\n\nClose Discord and continue?", "Close Discord", MessageBoxButtons.YesNo, MessageBoxIcon.Information, MessageBoxDefaultButton.Button2) != DialogResult.Yes)) return false;
        }
        string title = key switch {
            "launch" => "Opening Discord",
            "install" => "Installing Solcord",
            "update" => _discordUpdatedState ? "Turning Solcord back on" : "Updating Solcord",
            "repair" => _discordUpdatedState ? "Turning Solcord back on" : "Repairing Solcord",
            "rollback" => "Rolling back",
            "uninstall" => "Uninstalling Solcord",
            _ => "Working"
        };
        return await RunActionAsync(title, () => key switch {
            "install" => CompleteInstall(_engine.InstallNew(selected)),
            "update" => CompleteInstall(_engine.Update(selected)),
            "repair" => CompleteInstall(_engine.Repair(selected)),
            "rollback" => CompleteRollback(_engine.RollBack(selected)),
            "uninstall" => Uninstall(selected),
            "launch" => Launch(selected),
            _ => throw new InvalidOperationException("The selected Solcord operation is unavailable.")
        }, key);
    }

    private IReadOnlyList<string> RunningDiscordChannelsSafe()
    {
        try {return _engine.RunningDiscordChannels();}
        catch (Exception error) when (error is InvalidOperationException or System.ComponentModel.Win32Exception) {return [];}
    }

    /// <summary>
    /// "--launch" (the Start Menu "Solcord" entry): if Discord updated and turned
    /// Solcord off, turn it back on, open Discord, and close. Discord is never
    /// closed to do this; anything that needs a decision stays on screen.
    /// "--uninstall" (Settings &gt; Apps): put focus on Uninstall.
    /// </summary>
    private async Task ContinueStartupAsync()
    {
        InstallerStartup startup = _startup;
        _startup = InstallerStartup.Normal;
        if (startup == InstallerStartup.Uninstall)
        {
            ActionVisual uninstall = _actions["uninstall"];
            if (uninstall.Row.Visible && uninstall.Button.Enabled) {uninstall.Button.Focus(); _workspaceScroll.ScrollControlIntoView(uninstall.Row);}
            return;
        }
        if (startup != InstallerStartup.Heal) return;
        if (_recommendedKey == "launch") {if (await RunOperationAsync("launch", confirm: false)) Close(); return;}
        if (!_discordUpdatedState || _recommendedKey is not ("repair" or "update") || RunningDiscordChannelsSafe().Count > 0) return;
        string heal = _recommendedKey;
        if (await RunOperationAsync(heal, confirm: false) && _recommendedKey == "launch" && await RunOperationAsync("launch", confirm: false)) Close();
    }

    private string Launch(DiscordTarget selected)
    {
        _engine.Launch(selected);
        return $"Discord opened with Solcord {_manifest.CandidateLabel}.";
    }

    private string CompleteRollback(string backupDirectory)
    {
        string result = "The previous version was restored from its backup.";
        return WithNotes(result, _engine.LastLauncherWarning, UpdateSetupEntry());
    }

    private string Uninstall(DiscordTarget selected)
    {
        string backup = _engine.Uninstall(selected);
        string message = $"Solcord was removed and Discord is back to normal. A backup was saved in {backup}.";
        return WithNotes(message, _engine.LastLauncherWarning, UpdateSetupEntry());
    }

    private async void RunAction(string actionName, Func<string> action, string? retryKey = null) => await RunActionAsync(actionName, action, retryKey);

    private async Task<bool> RunActionAsync(string actionName, Func<string> action, string? retryKey = null)
    {
        if (_busy || _checkingState || _refreshingTargets) return false;
        _busy = true;
        ++_stateGeneration;
        Control? previousFocus = ActiveControl;
        UseWaitCursor = true;
        SetErrorDetails(null);
        UpdateInteractionState();
        SetState("Working", $"{actionName}…", "This usually takes a few seconds. Settings, add-ons, and account data stay in place.", StateTone.Protected, null);
        try
        {
            string result = await Task.Run(action);
            await RefreshTargetsAsync();
            _stateBody.Text = _errorDetails is null ? result : $"{result} Status refresh needs attention; open Error details.";
            return true;
        }
        catch (Exception error)
        {
            await RefreshInstallationStateAsync();
            bool pending = _engine.HasPendingRecovery();
            string? next = pending ? "rollback" : retryKey;
            SetErrorDetails(error);
            SetState("Action needed", $"{actionName} didn't finish", FriendlyError(error), StateTone.Danger, next, pending ? "Restore backup" : next is null ? null : "Try again");
            return false;
        }
        finally
        {
            _busy = false;
            UseWaitCursor = false;
            UpdateInteractionState();
            if (previousFocus is {IsDisposed: false, CanFocus: true}) previousFocus.Focus();
        }
    }

    private static string FriendlyError(Exception error)
    {
        string message = ErrorMessage(error).Replace('\r', ' ').Replace('\n', ' ');
        while (message.Contains("  ", StringComparison.Ordinal)) message = message.Replace("  ", " ", StringComparison.Ordinal);
        return message.Length <= 170 ? message : $"{message[..167]}…";
    }

    private static string ErrorMessage(Exception error)
    {
        // Only the message is shown: never dump stack traces, exception Data,
        // process arguments, credentials, or profile documents into the UI.
        string message = Regex.Replace(error.Message, @"(?im)\b(authorization|password|(?:access[_ -]?|refresh[_ -]?)?token|secret)\s*[:=]\s*[^\r\n]+", "$1: [redacted]");
        message = Regex.Replace(message, @"(?i)\bBearer\s+[A-Za-z0-9._~+/=-]+", "Bearer [redacted]");
        return message.Length <= 16_384 ? message : $"{message[..16_384]}\r\n[Message shortened]";
    }

    private void SetErrorDetails(Exception? error)
    {
        _errorDetails = error is null ? null : $"{error.GetType().Name}\r\n\r\n{ErrorMessage(error)}";
        _errorDetailsAction.Visible = error is not null;
        _errorDetailsAction.Enabled = error is not null && !_busy;
    }

    private static Form CreateErrorDetailsDialog(string details)
    {
        var dialog = new Form {Text = "Solcord Setup · Error details", ClientSize = new Size(680, 360), MinimumSize = new Size(520, 280), StartPosition = FormStartPosition.CenterParent, AutoScaleMode = AutoScaleMode.Dpi, Font = new Font("Segoe UI Variable Text", 9.5f), BackColor = Canvas, ForeColor = Ink, MinimizeBox = false, MaximizeBox = false};
        var layout = new TableLayoutPanel {Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 3, Padding = new Padding(16), Margin = Padding.Empty};
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 44));
        var explanation = NewLabel("Full error message and affected local paths. Nothing is uploaded. Select text to copy it if needed.", 9.25f, FontStyle.Regular, Body);
        explanation.AutoSize = true;
        explanation.Dock = DockStyle.Fill;
        explanation.Margin = new Padding(0, 0, 0, 12);
        var message = new TextBox {Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Vertical, WordWrap = true, Dock = DockStyle.Fill, Text = details, BackColor = Surface, ForeColor = Ink, AccessibleName = "Full installer error message", TabIndex = 0};
        var close = NewButton("Close", ButtonTone.Outline);
        close.Dock = DockStyle.Right;
        close.Width = 96;
        close.Margin = new Padding(0, 8, 0, 0);
        close.TabIndex = 1;
        close.DialogResult = DialogResult.Cancel;
        layout.Controls.Add(explanation, 0, 0);
        layout.Controls.Add(message, 0, 1);
        layout.Controls.Add(close, 0, 2);
        dialog.Controls.Add(layout);
        dialog.AcceptButton = close;
        dialog.CancelButton = close;
        return dialog;
    }

    private static Button NewButton(string text, ButtonTone tone)
    {
        var button = new Button {Text = text, Height = 36, Padding = new Padding(12, 0, 12, 0), FlatStyle = FlatStyle.Flat, Cursor = Cursors.Hand, UseVisualStyleBackColor = false, Font = new Font("Segoe UI Variable Text", 9.25f, FontStyle.Bold), TextAlign = ContentAlignment.MiddleCenter};
        ApplyButtonTone(button, tone);
        return button;
    }

    private static void ApplyButtonTone(Button button, ButtonTone tone)
    {
        button.FlatAppearance.BorderSize = 1;
        if (!button.Enabled) {
            button.BackColor = Disabled;
            button.ForeColor = DisabledInk;
            button.FlatAppearance.BorderColor = Color.FromArgb(176, 183, 179);
            button.FlatAppearance.MouseOverBackColor = Disabled;
            button.FlatAppearance.MouseDownBackColor = Disabled;
            return;
        }
        button.BackColor = tone switch {ButtonTone.Primary => Teal, ButtonTone.Danger => Surface, _ => Surface};
        button.ForeColor = tone switch {ButtonTone.Primary => Color.White, ButtonTone.Danger => Danger, _ => Ink};
        button.FlatAppearance.BorderColor = tone switch {ButtonTone.Primary => Teal, ButtonTone.Danger => Danger, _ => Color.FromArgb(140, 151, 148)};
        button.FlatAppearance.MouseOverBackColor = tone switch {ButtonTone.Primary => TealHover, ButtonTone.Danger => Color.FromArgb(255, 238, 235), _ => Color.FromArgb(237, 241, 238)};
        button.FlatAppearance.MouseDownBackColor = tone switch {ButtonTone.Primary => Color.FromArgb(7, 70, 65), ButtonTone.Danger => Color.FromArgb(249, 222, 218), _ => Color.FromArgb(221, 228, 224)};
    }

    private static Label NewLabel(string text, float size, FontStyle style, Color color) => new() {Text = text, Font = new Font("Segoe UI Variable Text", size, style), ForeColor = color, BackColor = Color.Transparent, Margin = new Padding(3, 0, 3, 0), UseMnemonic = false};

    private static Image? LoadBrandMark()
    {
        using Stream? stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("Solcord.Installer.Resources.solcord-mark.png");
        if (stream is null) return null;
        using var source = Image.FromStream(stream);
        return new Bitmap(source);
    }

    internal static void ValidateResponsiveOperations(string bundleRoot)
    {
        string fixtureRoot = Path.Combine(Path.GetTempPath(), $"solcord-ui-fixture-{Guid.NewGuid():N}");
        var engine = new InstallerEngine(bundleRoot, Path.Combine(fixtureRoot, "local"), Path.Combine(fixtureRoot, "roaming"), _ => 0);
        using var form = new InstallerForm(bundleRoot, engine);
        form.CreateControl();
        int ticks = 0;
        using var timer = new System.Windows.Forms.Timer {Interval = 10};
        timer.Tick += (_, _) => ticks++;
        timer.Start();
        // Warm the synchronous status path first so a slow CI runner's first-call
        // JIT and font work are not mistaken for engine work on the UI thread.
        form.SetState("Ready", "Warm-up", "Warm-up", StateTone.Protected, null);
        form.UpdateInteractionState();
        // The engine work takes 1.5 s; returning within 0.75 s proves it ran off the UI thread.
        var returned = System.Diagnostics.Stopwatch.StartNew();
        form.RunAction("Fixture delayed engine", () => {Thread.Sleep(1500); return "Fixture operation completed.";});
        long handlerMs = returned.ElapsedMilliseconds;
        if (handlerMs > 750 || !form._busy) throw new InvalidDataException($"installer-responsiveness: engine work blocked the UI handler ({handlerMs} ms, busy={form._busy})");
        var closing = new FormClosingEventArgs(CloseReason.UserClosing, false);
        form.OnFormClosing(closing);
        if (!closing.Cancel) throw new InvalidDataException("installer-responsiveness: close bypassed the active transaction");
        if (form._closeAction.Enabled || form._closeAction.Text != "Working…" || form._refreshTargetsAction.Enabled)
            throw new InvalidDataException("installer-responsiveness: active transaction did not explain disabled close/refresh");
        var deadline = System.Diagnostics.Stopwatch.StartNew();
        while (form._busy && deadline.ElapsedMilliseconds < 5000) {Application.DoEvents(); Thread.Sleep(1);}
        if (form._busy || ticks < 3 || form._stateBody.Text != "Fixture operation completed.")
            throw new InvalidDataException("installer-responsiveness: message pump or operation completion failed");
        if (!form._closeAction.Enabled || form._closeAction.Text != "Close" || form.CancelButton != form._closeAction)
            throw new InvalidDataException("installer-keyboard: idle Close/Escape was not restored");
        ValidateTargetReadiness(form, fixtureRoot);
        ValidatePlainStates(form, fixtureRoot);
        ValidateRefreshRecovery(form, engine);
        ValidateErrorDetails(form, fixtureRoot);
    }

    private static void ValidatePlainStates(InstallerForm form, string fixtureRoot)
    {
        var updated = new DiscordTarget("Stable", "1.2.4", Path.Combine(fixtureRoot, "Discord.exe"), "Discord");
        form._refreshingTargets = true;
        form._targets.Items.Clear();
        form._targets.Items.Add(updated);
        form._targets.SelectedIndex = 0;
        form._refreshingTargets = false;
        CompleteUiTask(form.RefreshInstallationStateAsync(_ => new(false, true, true, true, false, "1.2.3", "v2.0.0")), "discord-updated-state");
        if (form._recommendedKey != "repair" || form._primaryAction.Text != "Turn Solcord back on" || !form._discordUpdatedState || form._stateKind.Text != "Solcord is off" || !form._stateBody.Text.Contains("1.2.3", StringComparison.Ordinal))
            throw new InvalidDataException("installer-plain-states: a Discord update was not explained as Solcord being off with a one-click fix");
        CompleteUiTask(form.RefreshInstallationStateAsync(_ => new(false, true, true, false, false, "1.2.3", "v1.9.0")), "discord-updated-older-package");
        if (form._recommendedKey != "update" || form._primaryAction.Text != "Turn Solcord back on")
            throw new InvalidDataException("installer-plain-states: a Discord update with an older package did not offer turning Solcord back on");
        CompleteUiTask(form.RefreshInstallationStateAsync(_ => new(false, true, true, false, false, null, "v9.0.0", NewerInstalled: true)), "newer-installed-state");
        if (form._recommendedKey is not null || form._primaryAction.Enabled || form._verifyAction.Enabled || form._actions.Values.Any(action => action.Button.Enabled) || !form._stateTitle.Text.Contains("v9.0.0", StringComparison.Ordinal) || form._errorDetails is not null)
            throw new InvalidDataException("installer-plain-states: an older Setup offered to change a newer installation or reported an error");
        CompleteUiTask(form.RefreshInstallationStateAsync(_ => new(true, true, true, true, false)), "pending-state");
        if (form._recommendedKey != "rollback" || form._primaryAction.Text != "Restore backup")
            throw new InvalidDataException("installer-plain-states: an unfinished change did not offer Restore backup");
    }

    private static void CompleteUiTask(Task operation, string stage)
    {
        var deadline = System.Diagnostics.Stopwatch.StartNew();
        while (!operation.IsCompleted && deadline.ElapsedMilliseconds < 5000) {Application.DoEvents(); Thread.Sleep(1);}
        if (!operation.IsCompleted) throw new InvalidDataException($"installer-{stage}: asynchronous UI work did not settle");
        operation.GetAwaiter().GetResult();
    }

    private static void ValidateTargetReadiness(InstallerForm form, string fixtureRoot)
    {
        var first = new DiscordTarget("Stable", "1.2.3", Path.Combine(fixtureRoot, "Discord.exe"), "Discord");
        var second = new DiscordTarget("Canary", "2.3.4", Path.Combine(fixtureRoot, "DiscordCanary.exe"), "DiscordCanary");
        form._refreshingTargets = true;
        form._targets.Items.Add(first); form._targets.Items.Add(second); form._targets.SelectedIndex = 0;
        form._refreshingTargets = false;
        form.SetActionAvailability(true, true, true, true, false);
        form.SetState("Ready", "Old target is ready", "Old recommendation", StateTone.Protected, "launch");
        using var release = new ManualResetEventSlim();
        var returned = System.Diagnostics.Stopwatch.StartNew();
        Task previous = form.RefreshInstallationStateAsync(_ => {release.Wait(2000); return new(false, false, true, false, false);});
        // The check blocks for up to 2 s; returning within 0.75 s proves it ran off the UI thread.
        if (returned.ElapsedMilliseconds > 750 || form._primaryAction.Enabled || form._verifyAction.Enabled || form._actions.Values.Any(action => action.Button.Enabled))
            throw new InvalidDataException("installer-target-readiness: old-target action remained available during a new check");
        if (!form._refreshTargetsAction.Enabled || !form._closeAction.Enabled)
            throw new InvalidDataException("installer-target-readiness: read-only check trapped refresh or Close");
        bool actionEntered = false;
        form.RunAction("Fixture stale action", () => {actionEntered = true; return "This action must not run.";});
        if (form._busy || actionEntered) throw new InvalidDataException("installer-target-readiness: checking allowed another action to invalidate its refresh");
        form._refreshingTargets = true;
        form._targets.SelectedIndex = 1;
        form._refreshingTargets = false;
        CompleteUiTask(form.RefreshInstallationStateAsync(_ => new(false, true, true, false, false)), "target-readiness");
        if (!form._primaryAction.Enabled || form._recommendedKey != "update") throw new InvalidDataException("installer-target-readiness: newest selected target did not become available");
        release.Set(); CompleteUiTask(previous, "stale-target-readiness");
        if (form._recommendedKey != "update") throw new InvalidDataException("installer-target-readiness: stale result replaced the current target state");
        using var oldCheckRelease = new ManualResetEventSlim();
        using var newListRelease = new ManualResetEventSlim();
        using var oldCheckStarted = new ManualResetEventSlim();
        Task oldRefresh = form.RefreshTargetsAsync(() => new[] {first}, _ => {oldCheckStarted.Set(); oldCheckRelease.Wait(2000); return new(false, false, true, false, false);});
        var deadline = System.Diagnostics.Stopwatch.StartNew();
        while (!oldCheckStarted.IsSet && deadline.ElapsedMilliseconds < 5000) {Application.DoEvents(); Thread.Sleep(1);}
        if (!oldCheckStarted.IsSet) throw new InvalidDataException("installer-target-refresh: first readiness did not begin");
        Task newRefresh = form.RefreshTargetsAsync(() => {newListRelease.Wait(2000); return new[] {second};}, _ => new(false, true, true, false, false));
        oldCheckRelease.Set(); CompleteUiTask(oldRefresh, "superseded-refresh");
        if (!form._refreshingTargets || form._refreshTargetsAction.Enabled)
            throw new InvalidDataException("installer-target-refresh: superseded readiness released a newer refresh's controls");
        newListRelease.Set(); CompleteUiTask(newRefresh, "latest-refresh");
        if ((form._targets.SelectedItem as DiscordTarget) != second || form._recommendedKey != "update")
            throw new InvalidDataException("installer-target-refresh: current refresh did not keep its target and action");
    }

    private static void ValidateRefreshRecovery(InstallerForm form, InstallerEngine engine)
    {
        CompleteUiTask(form.RefreshTargetsAsync(() => Array.Empty<DiscordTarget>()), "empty-target-refresh");
        if (form._targets.Items.Count != 0 || !form._refreshTargetsAction.Enabled || form._primaryAction.Enabled)
            throw new InvalidDataException("installer-target-refresh: missing Discord did not leave a usable refresh action");
        CompleteUiTask(form.RefreshTargetsAsync(() => throw new IOException("Fixture discovery could not read a local directory.")), "failed-target-refresh");
        if (!form._refreshTargetsAction.Enabled || form._checkingState || form._refreshingTargets || form._errorDetails is null)
            throw new InvalidDataException("installer-target-refresh: failed discovery trapped retry or lost the error detail");
        Directory.CreateDirectory(engine.RecoveryDirectory);
        form.SetActionAvailability(false, false, false, false, false);
        if (!engine.RecoveryDirectory.Contains("solcord-ui-fixture-", StringComparison.Ordinal) || !form._recoveryAction.Enabled)
            throw new InvalidDataException("installer-recovery-directory: UI escaped its injected disposable roaming root");
    }

    private static void ValidateErrorDetails(InstallerForm form, string fixtureRoot)
    {
        string affectedPath = Path.Combine(fixtureRoot, new string('a', 220) + ".asar");
        var error = new IOException($"The file could not be replaced: {affectedPath}\r\nAuthorization: Bearer fixture-secret");
        form.SetErrorDetails(error);
        if (form._errorDetails is null || !form._errorDetails.Contains(affectedPath, StringComparison.Ordinal) || form._errorDetails.Contains("fixture-secret", StringComparison.Ordinal) || FriendlyError(error).Length > 170)
            throw new InvalidDataException("installer-error-details: complete local path or credential redaction failed");
        using Form dialog = CreateErrorDetailsDialog(form._errorDetails);
        TextBox message = dialog.Controls[0].Controls.OfType<TextBox>().Single();
        if (!message.ReadOnly || !message.WordWrap || message.ScrollBars != ScrollBars.Vertical || message.Text != form._errorDetails || dialog.CancelButton is null)
            throw new InvalidDataException("installer-error-details: details cannot be read or closed with Escape");
    }

    internal static void ValidateGeometryMatrix(string bundleRoot)
    {
        foreach (int dpi in new[] {96, 120, 144, 192})
        {
            float scale = dpi / 96F;
            foreach (Size logicalClient in new[] {new Size(760, 600), new Size(900, 650)})
            {
                using var form = new InstallerForm(bundleRoot);
                form.SetActionAvailability(true, true, false, true, false);
                form.SetState(
                    "Action needed",
                    "Turning Solcord back on didn't finish",
                    "Discord could not close automatically. Quit it from the system tray, then try again; plugins, themes, settings, and recovery files remain unchanged.",
                    StateTone.Danger,
                    // "install" also shows the install notes, so the tallest layout is measured.
                    "install",
                    "Turn Solcord back on"
                );
                form.SetErrorDetails(new IOException("The selected local archive could not be opened. Refresh the Discord app list or try again."));
                form.MinimumSize = Size.Empty;
                form.Scale(new SizeF(scale, scale));
                form.ClientSize = new Size(
                    (int)Math.Ceiling(logicalClient.Width * scale),
                    (int)Math.Ceiling(logicalClient.Height * scale)
                );
                form.CreateControl();
                // An unshown Form makes every child's Visible getter false. Use a
                // visible layout host without opening a window or running Load.
                using var layoutHost = new Panel {Size = form.ClientSize, Font = form.Font};
                Control shell = form.Controls[0];
                form.Controls.Remove(shell);
                layoutHost.Controls.Add(shell);
                PerformLayoutTree(layoutHost);
                string context = $"{dpi}dpi/{logicalClient.Width}x{logicalClient.Height}";
                ValidateControlTree(layoutHost, context);
                ValidateStableChrome(form, context, scale);
                ValidateAccessibleState(form, context);
            }
        }
    }

    private static void ValidateAccessibleState(InstallerForm form, string context)
    {
        foreach (string action in new[] {"install", "update", "repair", "rollback", "launch"})
        {
            form.SetState("Ready", "Solcord", "The selected version is ready.", StateTone.Protected, action);
            if (form._primaryAction.AccessibilityObject.Name != form._primaryAction.Text)
                throw new InvalidDataException($"installer-accessibility:{context}:{action}:action-name-mismatch");
        }
        form._stateBody.Text = "Verification finished. No files were changed.";
        if (form._stateBody.AccessibilityObject.Name != form._stateBody.Text)
            throw new InvalidDataException($"installer-accessibility:{context}:status-name-mismatch");
    }

    private static void ValidateStableChrome(InstallerForm form, string context, float scale)
    {
        const int tolerance = 2;
        Rectangle header = form._header.Bounds;
        Rectangle workspace = form._workspaceScroll.Bounds;
        Rectangle footer = form._footer.Bounds;
        if (header.Top > tolerance || Math.Abs(header.Bottom - workspace.Top) > tolerance || Math.Abs(workspace.Bottom - footer.Top) > tolerance || Math.Abs(footer.Bottom - form.ClientSize.Height) > tolerance)
            throw new InvalidDataException($"installer-layout:{context}:fixed-chrome-gap-or-overlap");

        int expectedBrandSize = (int)Math.Round(48 * scale);
        if (form._brandMarkHost.ClientSize.Width + tolerance < expectedBrandSize || form._brandMarkHost.ClientSize.Height + tolerance < expectedBrandSize)
            throw new InvalidDataException($"installer-layout:{context}:brand-mark-safe-area-collapsed");

        Padding safe = form._brandMarkHost.Padding;
        if (form._brandMark.Left < safe.Left || form._brandMark.Top < safe.Top || form._brandMark.Right > form._brandMarkHost.ClientSize.Width - safe.Right || form._brandMark.Bottom > form._brandMarkHost.ClientSize.Height - safe.Bottom)
            throw new InvalidDataException($"installer-layout:{context}:brand-mark-outside-safe-area");

        if (workspace.Width <= 0 || workspace.Height <= 0)
            throw new InvalidDataException($"installer-layout:{context}:workspace-scroll-owner-empty");

        if (form._primaryRow.Visible && (form._primaryRow.Height < form._primaryAction.Height || !form._primaryAction.Visible || form._primaryAction.Width <= 0 || form._primaryAction.Height <= 0))
            throw new InvalidDataException($"installer-layout:{context}:primary-action-collapsed");

        foreach (ActionVisual visual in form._actions.Values.Where(action => action.Row.Visible))
        {
            int minimumRow = (int)Math.Floor(44 * scale) - tolerance;
            int maximumRow = (int)Math.Ceiling(52 * scale) + tolerance;
            int expectedButtonWidth = (int)Math.Round(112 * scale);
            int expectedButtonHeight = (int)Math.Round(36 * scale);
            if (visual.Row.Height < minimumRow || visual.Row.Height > maximumRow || Math.Abs(visual.Button.Width - expectedButtonWidth) > tolerance || Math.Abs(visual.Button.Height - expectedButtonHeight) > tolerance)
                throw new InvalidDataException($"installer-layout:{context}:{visual.Title}:maintenance-action-geometry");
            int expectedInset = (int)Math.Round(14 * scale);
            Control copy = visual.Row.Controls.OfType<TableLayoutPanel>().Single();
            if (Math.Abs(visual.Row.ClientSize.Width - visual.Button.Right - expectedInset) > tolerance || copy.Right > visual.Button.Left - expectedInset + tolerance)
                throw new InvalidDataException($"installer-layout:{context}:{visual.Title}:maintenance-action-alignment");
        }

        Rectangle headerBefore = form._header.Bounds;
        Rectangle footerBefore = form._footer.Bounds;
        form._workspaceScroll.AutoScrollPosition = new Point(0, Math.Min(72, Math.Max(0, form._workspace.Height - form._workspaceScroll.ClientSize.Height)));
        PerformLayoutTree(form._workspaceScroll.Parent!);
        if (form._header.Bounds != headerBefore || form._footer.Bounds != footerBefore)
            throw new InvalidDataException($"installer-layout:{context}:workspace-scroll-moved-fixed-chrome");
    }

    private static void PerformLayoutTree(Control control)
    {
        control.PerformLayout();
        foreach (Control child in control.Controls) PerformLayoutTree(child);
        control.PerformLayout();
    }

    private static void ValidateControlTree(Control parent, string context)
    {
        const int tolerance = 2;
        bool allowsVerticalOverflow = parent is ScrollableControl scrollOwner && scrollOwner.AutoScroll;
        foreach (Control child in parent.Controls)
        {
            if (!child.Visible) continue;
            if (child.Width <= 0 || child.Height <= 0) throw new InvalidDataException($"installer-layout:{context}:{child.Name}:{child.GetType().Name}:empty");
            if (child.Left < -tolerance || child.Top < -tolerance || child.Right > parent.ClientSize.Width + tolerance || !allowsVerticalOverflow && child.Bottom > parent.ClientSize.Height + tolerance)
                throw new InvalidDataException($"installer-layout:{context}:{parent.Name}:{parent.AccessibleName}:{parent.GetType().Name}->{child.Name}:{child.GetType().Name}:outside-parent ({child.Bounds} in {parent.ClientSize})");

            if (child is Button button && !string.IsNullOrWhiteSpace(button.Text))
            {
                Size text = TextRenderer.MeasureText(button.Text, button.Font, Size.Empty, TextFormatFlags.SingleLine | TextFormatFlags.NoPadding);
                if (text.Width + button.Padding.Horizontal + 6 > button.ClientSize.Width || text.Height + 6 > button.ClientSize.Height)
                    throw new InvalidDataException($"installer-layout:{context}:{button.Text}:button-text-clipped");
            }
            else if (child is Label label && !string.IsNullOrWhiteSpace(label.Text) && !label.AutoEllipsis)
            {
                Size proposal = new(Math.Max(1, label.ClientSize.Width), int.MaxValue);
                Size text = TextRenderer.MeasureText(label.Text, label.Font, proposal, TextFormatFlags.WordBreak | TextFormatFlags.NoPadding);
                if (text.Height > label.ClientSize.Height + tolerance)
                    throw new InvalidDataException($"installer-layout:{context}:{label.Text}:label-text-clipped ({text.Width}x{text.Height} in {label.ClientSize.Width}x{label.ClientSize.Height}, {label.DeviceDpi}dpi)");
            }

            ValidateControlTree(child, context);
        }
    }

    private enum ButtonTone {Primary, Outline, Danger}
    private enum StateTone {Protected, Warning, Danger}
    private sealed record InstallationState(bool Pending, bool Managed, bool ChannelMatches, bool PackageRecorded, bool Exact, string? RecordedVersion = null, string? InstalledLabel = null, bool NewerInstalled = false);
    private sealed record ActionVisual(string Title, string Description, Control Row, Button Button, ButtonTone Tone, int RowIndex);
}
