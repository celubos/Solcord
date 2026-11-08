// SPDX-License-Identifier: Apache-2.0

using System.Reflection;

namespace Solcord.Installer;

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
    private readonly ComboBox _targets = new();
    private readonly Label _stateKind = new();
    private readonly Label _stateTitle = new();
    private readonly Label _stateBody = new();
    private readonly Panel _statePanel = new();
    private readonly Button _primaryAction;
    private readonly Button _verifyAction;
    private readonly Button _recoveryAction;
    private readonly Label _maintenanceHeading = new();
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
    private int _stateGeneration;
    private Color _stateBorder = Color.FromArgb(118, 171, 163);

    internal InstallerForm(string bundleRoot, InstallerEngine? engine = null)
    {
        _engine = engine ?? new InstallerEngine(bundleRoot, Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData));
        _manifest = _engine.LoadManifest();
        _primaryAction = NewButton("Continue", ButtonTone.Primary);
        _verifyAction = NewButton("Verify files", ButtonTone.Outline);
        _recoveryAction = NewButton("Open recovery folder", ButtonTone.Outline);

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
        Load += (_, _) => RefreshTargets();
        Shown += (_, _) => _primaryAction.Focus();
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
        var subtitle = NewLabel("Install, repair, or restore Solcord.", 9.25f, FontStyle.Regular, Body);
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
        _workspace.RowCount = 6;
        _workspace.Padding = new Padding(36, 12, 36, 12);
        _workspace.Margin = Padding.Empty;
        for (int i = 0; i < _workspace.RowCount; i++) _workspace.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        _workspace.Controls.Add(BuildTargetField(), 0, 0);
        _workspace.Controls.Add(BuildStatePanel(), 0, 1);
        _workspace.Controls.Add(BuildPrimaryAction(), 0, 2);
        _workspace.Controls.Add(BuildMaintenanceHeader(), 0, 3);
        _workspace.Controls.Add(BuildMaintenanceList(), 0, 4);
        _workspace.Controls.Add(BuildUtilities(), 0, 5);
        _workspaceScroll.Controls.Add(_workspace);
        return _workspaceScroll;
    }

    private Control BuildTargetField()
    {
        var field = new TableLayoutPanel {Dock = DockStyle.Top, AutoSize = true, MinimumSize = new Size(0, 40), ColumnCount = 2, RowCount = 1, BackColor = Canvas, Margin = new Padding(0, 0, 0, 8), Padding = Padding.Empty};
        field.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 136));
        field.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        field.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        var label = NewLabel("Version", 9.5f, FontStyle.Bold, Ink);
        label.Dock = DockStyle.Fill;
        label.TextAlign = ContentAlignment.MiddleLeft;
        _targets.DropDownStyle = ComboBoxStyle.DropDownList;
        _targets.FormattingEnabled = true;
        _targets.Dock = DockStyle.Fill;
        _targets.Margin = new Padding(0, 5, 0, 5);
        _targets.BackColor = Surface;
        _targets.ForeColor = Ink;
        _targets.FlatStyle = FlatStyle.Flat;
        _targets.TabIndex = 0;
        _targets.AccessibleName = "Discord version";
        _targets.AccessibleDescription = "Choose an installed Stable, PTB, or Canary version.";
        _targets.Format += (_, eventArgs) => {if (eventArgs.ListItem is DiscordTarget target) eventArgs.Value = $"{target.Channel} · {target.Version}";};
        field.Controls.Add(label, 0, 0);
        field.Controls.Add(_targets, 1, 0);
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

    private Control BuildMaintenanceHeader()
    {
        var header = new TableLayoutPanel {Dock = DockStyle.Top, AutoSize = true, MinimumSize = new Size(0, 30), ColumnCount = 1, RowCount = 1, BackColor = Canvas, Margin = Padding.Empty, Padding = Padding.Empty};
        header.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        _maintenanceHeading.Text = "Recovery";
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
        _maintenanceList.RowCount = 3;
        _maintenanceList.BackColor = Surface;
        _maintenanceList.Margin = Padding.Empty;
        _maintenanceList.Padding = Padding.Empty;
        for (int i = 0; i < 3; i++) _maintenanceList.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        _maintenanceList.Controls.Add(ActionRow("repair", "Repair Solcord", "Reinstall this exact package if files are missing or damaged.", 2, 0), 0, 0);
        _maintenanceList.Controls.Add(ActionRow("rollback", "Roll back", "Restore the verified backup made before the last change.", 3, 1), 0, 1);
        _maintenanceList.Controls.Add(ActionRow("uninstall", "Uninstall Solcord", "Remove Solcord and keep plugins, themes, settings, and recovery files.", 4, 2, ButtonTone.Danger), 0, 2);
        return _maintenanceList;
    }

    private Control ActionRow(string key, string title, string description, int tabIndex, int rowIndex, ButtonTone tone = ButtonTone.Outline)
    {
        var row = new Panel {Dock = DockStyle.Fill, AutoSize = false, Height = 48, MinimumSize = new Size(0, 44), BackColor = Surface, Margin = Padding.Empty, Padding = Padding.Empty, AccessibleName = title};
        row.Paint += (_, args) => {if (rowIndex < 2) {using var rule = new Pen(Line, 1); args.Graphics.DrawLine(rule, 18, row.ClientSize.Height - 1, row.ClientSize.Width - 14, row.ClientSize.Height - 1);}};
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
        var button = NewButton(title.Replace("Solcord", "").Trim(), tone);
        button.Anchor = AnchorStyles.Top | AnchorStyles.Right;
        button.AutoSize = false;
        button.Size = new Size(112, 36);
        button.Margin = Padding.Empty;
        button.TextAlign = ContentAlignment.MiddleCenter;
        button.TabIndex = tabIndex;
        button.AccessibleName = title;
        button.AccessibleDescription = description;
        button.Click += (_, _) => RunOperation(key);
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
        var utilities = new TableLayoutPanel {Dock = DockStyle.Top, AutoSize = true, MinimumSize = new Size(0, 44), ColumnCount = 3, RowCount = 1, BackColor = Canvas, Margin = Padding.Empty, Padding = new Padding(0, 6, 0, 0)};
        utilities.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 144));
        utilities.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 196));
        utilities.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        _verifyAction.Dock = DockStyle.Fill;
        _verifyAction.Margin = new Padding(0, 0, 8, 0);
        _verifyAction.TabIndex = 5;
        _verifyAction.AccessibleName = "Verify installed Solcord files";
        _verifyAction.Click += (_, _) => {
            DiscordTarget selected = Target();
            RunAction("Verification", () => _engine.VerifyInstalled(selected) ? $"Installed files match {_manifest.CandidateLabel} for {selected.Channel} {selected.Version}." : $"Installed files do not match {_manifest.CandidateLabel} for {selected.Channel} {selected.Version}.");
        };
        _recoveryAction.Dock = DockStyle.Fill;
        _recoveryAction.Margin = new Padding(0, 0, 8, 0);
        _recoveryAction.TabIndex = 6;
        _recoveryAction.AccessibleName = "Open recovery folder";
        _recoveryAction.Click += (_, _) => RunAction("Recovery files", () => {
            System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "BetterDiscord", "solcord-installer")) {UseShellExecute = true});
            return "Opened the Solcord recovery folder.";
        });
        utilities.Controls.Add(_verifyAction, 0, 0);
        utilities.Controls.Add(_recoveryAction, 1, 0);
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
        var close = NewButton("Close", ButtonTone.Outline);
        close.Dock = DockStyle.Fill;
        close.Margin = Padding.Empty;
        close.TabIndex = 7;
        close.AccessibleName = "Close installer";
        close.Click += (_, _) => Close();
        layout.Controls.Add(note, 0, 0);
        layout.Controls.Add(close, 1, 0);
        _footer.Controls.Add(layout);
        return _footer;
    }

    private void RefreshTargets()
    {
        DiscordTarget? previous = _targets.SelectedItem as DiscordTarget;
        _targets.Items.Clear();
        foreach (DiscordTarget target in _engine.DetectTargets()) _targets.Items.Add(target);
        // Retain an explicit route to the receipt-selected older version after
        // Discord downloads an update, including managed rollback and launch.
        try
        {
            DiscordTarget? managed = _engine.ManagedTarget();
            if (managed is not null && !_targets.Items.Cast<DiscordTarget>().Any(target => target.Channel == managed.Channel && target.Version == managed.Version))
                _targets.Items.Add(managed);
        }
        catch (Exception error) when (error is IOException or InvalidDataException or UnauthorizedAccessException) {/* Readiness errors are shown by the selected-target check. */}
        if (_targets.Items.Count > 0)
        {
            int previousIndex = previous is null ? -1 : _targets.Items.Cast<DiscordTarget>().ToList().FindIndex(target => target.Channel == previous.Channel && target.Version == previous.Version);
            _targets.SelectedIndex = previousIndex >= 0 ? previousIndex : 0;
        }
        else {SetState("Discord not found", "Install Discord first", "Stable, PTB, or Canary was not detected on this PC.", StateTone.Warning, null); SetActionAvailability(false, false, false, false, false);}
    }

    private async void RefreshInstallationState()
    {
        if (!_busy) await RefreshInstallationStateAsync();
    }

    private async Task RefreshInstallationStateAsync()
    {
        DiscordTarget? selected = _targets.SelectedItem as DiscordTarget;
        bool targetReady = selected is not null;
        if (!targetReady) {SetActionAvailability(false, false, false, false, false); return;}
        int generation = ++_stateGeneration;
        try
        {
            var status = await Task.Run(() => {
                bool pending = _engine.HasPendingRecovery();
                bool managed = _engine.HasManagedInstall();
                bool channelMatches = _engine.IsManagedChannel(selected!);
                bool packageRecorded = managed && channelMatches && _engine.IsCurrentPackageRecorded();
                bool exact = !pending && packageRecorded && _engine.VerifyInstalled(selected);
                return (pending, managed, channelMatches, packageRecorded, exact);
            });
            if (IsDisposed || generation != _stateGeneration) return;
            var (pending, managed, channelMatches, packageRecorded, exact) = status;
            if (managed && !channelMatches)
            {
                SetActionAvailability(false, false, false, false, false);
                SetState("Different channel", "Select the managed Discord channel", "Solcord manages one channel at a time. Uninstall from its recorded channel before switching.", StateTone.Warning, null);
                return;
            }
            SetActionAvailability(targetReady, managed, exact, packageRecorded, pending);
            if (pending) SetState("Recovery required", "Restore the last known state", "A previous change stopped early. Restore its backup to continue.", StateTone.Warning, "rollback");
            else if (exact) SetState("Installed and verified", $"{_manifest.CandidateLabel} is ready", "Installed files match this package.", StateTone.Protected, "launch");
            else if (packageRecorded) SetState("Repair available", "Restore this build", "The release receipt matches, but installed files changed.", StateTone.Warning, "repair");
            else if (managed) SetState("Update available", $"Update to {_manifest.CandidateLabel}", "The current version will be backed up first.", StateTone.Warning, "update");
            else SetState("Ready to install", $"Install {_manifest.CandidateLabel}", "BetterDiscord settings and add-ons stay in place.", StateTone.Protected, "install");
        }
        catch (Exception error)
        {
            if (IsDisposed || generation != _stateGeneration) return;
            SetActionAvailability(false, false, false, false, _engine.HasPendingRecovery());
            SetState("Needs attention", "Review before continuing", error.Message, StateTone.Danger, _engine.HasPendingRecovery() ? "rollback" : null);
        }
    }

    private void SetActionAvailability(bool targetReady, bool managed, bool exact, bool packageRecorded, bool pending)
    {
        SetManagedAction("repair", targetReady && packageRecorded && !pending);
        SetManagedAction("rollback", targetReady && (managed || pending));
        SetManagedAction("uninstall", targetReady && managed && !pending);
        bool anyMaintenance = _actions.Values.Any(action => action.Row.Visible);
        _maintenanceHeading.Visible = anyMaintenance;
        _verifyAction.Enabled = targetReady && managed && !pending;
        ApplyButtonTone(_verifyAction, ButtonTone.Outline);
        _recoveryAction.Enabled = Directory.Exists(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "BetterDiscord", "solcord-installer"));
        ApplyButtonTone(_recoveryAction, ButtonTone.Outline);
    }

    private void SetManagedAction(string key, bool visible)
    {
        ActionVisual visual = _actions[key];
        visual.Row.Visible = visible;
        visual.Button.Enabled = visible;
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
        _primaryAction.Enabled = recommendedKey is not null;
        _primaryAction.Visible = recommendedKey is not null;
        _primaryRow.Visible = recommendedKey is not null;
        _primaryRow.Height = recommendedKey is null ? 0 : 46;
        _primaryAction.Text = primaryLabel ?? recommendedKey switch {"install" => "Install Solcord", "update" => "Update Solcord", "repair" => "Repair Solcord", "rollback" => "Roll back", "launch" => "Open Solcord", _ => "Continue"};
        _primaryAction.AccessibleDescription = body;
        ApplyButtonTone(_primaryAction, ButtonTone.Primary);
    }

    private DiscordTarget Target() => _targets.SelectedItem as DiscordTarget ?? throw new InvalidOperationException("Select an installed Discord channel first.");

    private string CompleteInstall(InstallReceipt receipt)
    {
        string result = $"Installed and verified {receipt.CandidateLabel ?? "the selected candidate"} for Discord {receipt.Channel} {receipt.DiscordVersion}.";
        return _engine.LastLauncherWarning is null ? $"{result} Windows Search now includes Solcord." : $"{result} {_engine.LastLauncherWarning}";
    }

    private void RunOperation(string key)
    {
        if (_busy) return;
        DiscordTarget selected = Target();
        if (key == "uninstall" && MessageBox.Show("Remove Solcord from this Discord installation?\n\nDiscord returns to normal. Plugins, themes, settings, and recovery files stay on disk.", "Uninstall Solcord", MessageBoxButtons.YesNo, MessageBoxIcon.Warning, MessageBoxDefaultButton.Button2) != DialogResult.Yes) return;
        ActionVisual? visual = _actions.GetValueOrDefault(key);
        string title = visual?.Title ?? (key == "launch" ? "Open Solcord" : key == "install" ? "Install Solcord" : key == "update" ? "Update Solcord" : "Solcord operation");
        RunAction(title, () => key switch {
            "install" => CompleteInstall(_engine.InstallNew(selected)),
            "update" => CompleteInstall(_engine.Update(selected)),
            "repair" => CompleteInstall(_engine.Repair(selected)),
            "rollback" => CompleteRollback(_engine.RollBack(selected)),
            "uninstall" => Uninstall(selected),
            "launch" => Launch(selected),
            _ => throw new InvalidOperationException("The selected Solcord operation is unavailable.")
        }, key);
    }

    private string Launch(DiscordTarget selected)
    {
        _engine.Launch(selected);
        return $"Discord opened with Solcord {_manifest.CandidateLabel}.";
    }

    private string CompleteRollback(string backupDirectory)
    {
        string result = "The previous installation and its ownership record were restored from the verified backup.";
        return _engine.LastLauncherWarning is null ? result : $"{result} {_engine.LastLauncherWarning}";
    }

    private string Uninstall(DiscordTarget selected)
    {
        string backup = _engine.Uninstall(selected);
        string message = $"Solcord was removed. A recovery copy was saved at {backup}.";
        return _engine.LastLauncherWarning is null ? message : $"{message} {_engine.LastLauncherWarning}";
    }

    private async void RunAction(string actionName, Func<string> action, string? retryKey = null)
    {
        if (_busy) return;
        _busy = true;
        ++_stateGeneration;
        Control? previousFocus = ActiveControl;
        _targets.Enabled = false;
        UseWaitCursor = true;
        foreach (ActionVisual visual in _actions.Values) visual.Button.Enabled = false;
        _primaryAction.Enabled = false;
        _verifyAction.Enabled = false;
        _recoveryAction.Enabled = false;
        SetState("Working", actionName, "Settings, add-ons, and account data stay in place.", StateTone.Protected, null);
        try {string result = await Task.Run(action); RefreshTargets(); await RefreshInstallationStateAsync(); _stateBody.Text = result;}
        catch (Exception error)
        {
            await RefreshInstallationStateAsync();
            bool pending = _engine.HasPendingRecovery();
            string? next = pending ? "rollback" : retryKey;
            SetState("Action needed", $"{actionName} couldn't finish", FriendlyError(error), StateTone.Danger, next, pending ? "Restore backup" : next is null ? null : "Try again");
        }
        finally
        {
            _busy = false;
            _targets.Enabled = true;
            UseWaitCursor = false;
            if (previousFocus is {IsDisposed: false, CanFocus: true}) previousFocus.Focus();
        }
    }

    private static string FriendlyError(Exception error)
    {
        string message = error.Message.Replace('\r', ' ').Replace('\n', ' ');
        while (message.Contains("  ", StringComparison.Ordinal)) message = message.Replace("  ", " ", StringComparison.Ordinal);
        return message.Length <= 170 ? message : $"{message[..167]}…";
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
        var returned = System.Diagnostics.Stopwatch.StartNew();
        form.RunAction("Fixture delayed engine", () => {Thread.Sleep(350); return "Fixture operation completed.";});
        if (returned.ElapsedMilliseconds > 150 || !form._busy) throw new InvalidDataException("installer-responsiveness: engine work blocked the UI handler");
        var closing = new FormClosingEventArgs(CloseReason.UserClosing, false);
        form.OnFormClosing(closing);
        if (!closing.Cancel) throw new InvalidDataException("installer-responsiveness: close bypassed the active transaction");
        var deadline = System.Diagnostics.Stopwatch.StartNew();
        while (form._busy && deadline.ElapsedMilliseconds < 5000) {Application.DoEvents(); Thread.Sleep(1);}
        if (form._busy || ticks < 3 || form._stateBody.Text != "Fixture operation completed.")
            throw new InvalidDataException("installer-responsiveness: message pump or operation completion failed");
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
                    "Update Solcord couldn't finish",
                    "Discord could not close automatically. Quit it from the system tray, then try again; plugins, themes, settings, and recovery files remain unchanged.",
                    StateTone.Danger,
                    "update",
                    "Try again"
                );
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
    private sealed record ActionVisual(string Title, string Description, Control Row, Button Button, ButtonTone Tone, int RowIndex);
}
