import os, zipfile, time

SRC = r"C:/Users/45518/WorkBuddy/EHS电子化管理系统/ehs-system"
STAGE = r"C:/Users/45518/WorkBuddy/EHS电子化管理系统/ehs-system/deploy/EHS-Upgrade-v1.0.0"
OUT = r"C:/Users/45518/WorkBuddy/EHS电子化管理系统/ehs-system/deploy/EHS-Upgrade-v1.0.0-full.zip"
TOP = "EHS-Upgrade-v1.0.0"

SKIP_DIRS = {'.git', 'node_modules/.cache', '__pycache__', 'data', 'dist-tmp'}
SKIP_FILES_EXT = {'.log'}
SKIP_FILES_NAME = {'.env', '.DS_Store'}

def should_skip_dir(d):
    return d in SKIP_DIRS or d.startswith('node_modules/.cache')

def add_dir(z, base_fs, arc_prefix):
    count = 0
    for root, dirs, files in os.walk(base_fs):
        dirs[:] = [d for d in dirs if not should_skip_dir(d)]
        rel = os.path.relpath(root, base_fs)
        for f in files:
            if f in SKIP_FILES_NAME or f.endswith(tuple(SKIP_FILES_EXT)):
                continue
            fp = os.path.join(root, f)
            arc = os.path.normpath(os.path.join(arc_prefix, rel, f)).replace('\\', '/')
            z.write(fp, arc)
            count += 1
    return count

t0 = time.time()
z = zipfile.ZipFile(OUT, 'w', zipfile.ZIP_DEFLATED, compresslevel=6)
n = 0
n += add_dir(z, os.path.join(SRC, 'backend', 'dist'), f'{TOP}/backend/dist')
n += add_dir(z, os.path.join(SRC, 'backend', 'node_modules'), f'{TOP}/backend/node_modules')
n += add_dir(z, os.path.join(SRC, 'frontend', 'dist'), f'{TOP}/frontend/dist')
n += add_dir(z, os.path.join(SRC, 'frontend', 'node_modules'), f'{TOP}/frontend/node_modules')
z.write(os.path.join(STAGE, 'backend', 'runtime-alias.cjs'), f'{TOP}/backend/runtime-alias.cjs')
z.write(os.path.join(STAGE, 'backend', '.env.deploy'), f'{TOP}/backend/.env.deploy')
for f in ['start-service.bat', 'upgrade.bat', 'README.md']:
    z.write(os.path.join(STAGE, f), f'{TOP}/{f}')
z.close()
print(f"DONE files={n} size={os.path.getsize(OUT)/1024/1024:.1f}MB elapsed={time.time()-t0:.0f}s")
