"""Run the local schema-only calendar harness plus synthetic delay verification.
No hosted access, provider requests, credentials or source rows are copied.
"""
import runpy
import sys
from pathlib import Path
sys.argv.append('--include-delays')
runpy.run_path(str(Path(__file__).with_name('learn-work-calendars.py')), run_name='__main__')
