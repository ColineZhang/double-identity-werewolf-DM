param([string]$VoiceName = 'Microsoft Huihui Desktop')
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
Add-Type -AssemblyName System.Speech
$packRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\public\voicepacks\2023-6p-v02'))
$manifestPath = Join-Path $packRoot 'pack.json'
$pack = Get-Content -LiteralPath $manifestPath -Encoding UTF8 -Raw | ConvertFrom-Json
$synth = [System.Speech.Synthesis.SpeechSynthesizer]::new()
try {
    $synth.SelectVoice($VoiceName)
    $synth.Rate = -1
    $format = [System.Speech.AudioFormat.SpeechAudioFormatInfo]::new(22050, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
    foreach ($cue in $pack.cues.PSObject.Properties) {
        $filePath = Join-Path $packRoot $cue.Value.file
        $synth.SetOutputToWaveFile($filePath, $format)
        $synth.Speak($cue.Value.text)
        $synth.SetOutputToNull()
        # RIFF headers can contain additional chunks. Find the data chunk rather than assuming 44 bytes.
        $stream = [System.IO.File]::OpenRead($filePath)
        $reader = [System.IO.BinaryReader]::new($stream)
        try {
            $stream.Position = 12
            while ($stream.Position -lt $stream.Length) {
                $id = [System.Text.Encoding]::ASCII.GetString($reader.ReadBytes(4))
                $length = $reader.ReadUInt32()
                if ($id -eq 'data') { $cue.Value.durationMs = [int][Math]::Ceiling($length / 44100.0 * 1000); break }
                $stream.Position += $length + ($length % 2)
            }
        } finally { $reader.Dispose() }
        # TTS appends long silence. Trim countdown clips so consecutive seconds never overlap.
        if ($cue.Name.StartsWith('count.')) {
            $bytes = [System.IO.File]::ReadAllBytes($filePath)
            $offset = 12
            while ([System.Text.Encoding]::ASCII.GetString($bytes, $offset, 4) -ne 'data') {
                $chunkLength = [BitConverter]::ToUInt32($bytes, $offset + 4)
                $offset += 8 + $chunkLength + ($chunkLength % 2)
            }
            $dataStart = $offset + 8
            $last = $dataStart + [BitConverter]::ToUInt32($bytes, $offset + 4) - 2
            while ($last -gt $dataStart -and [Math]::Abs([int][BitConverter]::ToInt16($bytes, $last)) -lt 100) { $last -= 2 }
            $dataLength = [Math]::Min($bytes.Length - $dataStart, $last - $dataStart + 2 + 2206)
            $trimmed = New-Object byte[] ($dataStart + $dataLength)
            [Array]::Copy($bytes, $trimmed, $trimmed.Length)
            [Array]::Copy([BitConverter]::GetBytes([uint32]($trimmed.Length - 8)), 0, $trimmed, 4, 4)
            [Array]::Copy([BitConverter]::GetBytes([uint32]$dataLength), 0, $trimmed, $offset + 4, 4)
            [System.IO.File]::WriteAllBytes($filePath, $trimmed)
            $cue.Value.durationMs = [int][Math]::Ceiling($dataLength / 44100.0 * 1000)
            if ($cue.Value.durationMs -gt 1000) { throw 'Countdown clip exceeds one second' }
        }
    }
    $pack.voice = $VoiceName
    [System.IO.File]::WriteAllText($manifestPath, ($pack | ConvertTo-Json -Depth 10), [System.Text.UTF8Encoding]::new($false))
    Write-Output ('Generated {0} WAV clips in {1}' -f @($pack.cues.PSObject.Properties).Count, $packRoot)
} finally { $synth.Dispose() }
