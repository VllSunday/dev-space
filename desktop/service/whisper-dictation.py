"""Offline dictation. Audio and transcripts are never logged."""
import argparse
import json
import os
from pathlib import Path
import sysconfig

parser = argparse.ArgumentParser()
parser.add_argument('--model', required=True)
parser.add_argument('--audio', required=True)
args = parser.parse_args()

# A model may opt into GPU inference without changing the running desktop service.
# Models without these local settings retain the portable CPU defaults.
settings_file = Path(args.model) / 'mrmak-inference.json'
settings = json.loads(settings_file.read_text(encoding='utf-8')) if settings_file.is_file() else {}
if not isinstance(settings, dict) or set(settings) - {'device', 'compute_type'}:
    raise ValueError('Invalid local Whisper inference settings')
device = settings.get('device', 'cpu')
compute_type = settings.get('compute_type', 'float16' if device == 'cuda' else 'int8')
if device not in ('cpu', 'cuda') or compute_type not in ('int8', 'float16', 'float32', 'int8_float16'):
    raise ValueError('Unsupported local Whisper device or precision')
if device == 'cpu' and compute_type in ('float16', 'int8_float16'):
    raise ValueError('Float16 inference requires CUDA')

# The existing VoiceInput environment can provide NVIDIA pip wheels. CTranslate2
# loads their DLLs by name, so expose only this interpreter's library directories.
dll_handles = []
if os.name == 'nt' and device == 'cuda':
    nvidia = Path(sysconfig.get_path('purelib')) / 'nvidia'
    directories = [str(folder) for folder in nvidia.glob('*/bin') if folder.is_dir()]
    if directories:
        os.environ['PATH'] = os.pathsep.join(directories + [os.environ.get('PATH', '')])
        dll_handles = [os.add_dll_directory(folder) for folder in directories]

from faster_whisper import WhisperModel
from faster_whisper.audio import decode_audio

model = WhisperModel(args.model, device=device, compute_type=compute_type, cpu_threads=4, local_files_only=True)
audio = decode_audio(args.audio, sampling_rate=16000)
if len(audio) > 125 * 16000:
    raise ValueError('Recording exceeds two minutes')
segments, info = model.transcribe(audio, task='transcribe', vad_filter=True, beam_size=5, condition_on_previous_text=False)
print(json.dumps({'text': ' '.join(segment.text.strip() for segment in segments).strip()}))
