import hashlib
import random
import string
import datetime
import os

# =================================================================
# SECURITY SETTING: Change this to your own unique random string!
# =================================================================
SECRET_SALT = "X-FOLLOW-PRO-SECRET-2026"
LOG_FILE = "issued_keys.log"

def generate_key(prefix="PRO"):
    """
    Generates a license key with a checksum.
    Format: XFP-{RANDOM_4}-{CHECKSUM_4}
    """
    # 1. Generate random string (4 chars)
    random_part = ''.join(random.choices(string.ascii_uppercase + string.digits, k=4))
    
    # 2. Calculate Checksum
    raw_str = f"{SECRET_SALT}{random_part}"
    full_hash = hashlib.sha256(raw_str.encode()).hexdigest()
    checksum = full_hash[:4].upper()
    
    return f"XFP-{random_part}-{checksum}"

def log_keys(keys, note="Generated manually"):
    """
    Appends generated keys to a log file.
    """
    timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    
    with open(LOG_FILE, "a", encoding="utf-8") as f:
        # If file is empty, write header
        if os.stat(LOG_FILE).st_size == 0:
            f.write("Time | License Key | Note\n")
            f.write("-" * 50 + "\n")
            
        for key in keys:
            f.write(f"{timestamp} | {key} | {note}\n")
            
    print(f"\n✅ Keys saved to {LOG_FILE}")

def verify_key(key):
    """
    Verifies if a key is valid locally.
    """
    parts = key.split('-')
    if len(parts) != 3 or parts[0] != "XFP":
        return False
    
    random_part = parts[1]
    provided_checksum = parts[2]
    
    raw_str = f"{SECRET_SALT}{random_part}"
    expected_checksum = hashlib.sha256(raw_str.encode()).hexdigest()[:4].upper()
    
    return provided_checksum == expected_checksum

if __name__ == "__main__":
    print("--- X-Follow Pro License Generator ---")
    
    try:
        count = int(input("How many keys to generate? (Default 1): ") or 1)
    except ValueError:
        count = 1
        
    note = input("Add a note (e.g. 'For User John', 'Test Batch'): ") or "No note"

    new_keys = []
    print("\nGenerated Keys:")
    for _ in range(count):
        k = generate_key()
        new_keys.append(k)
        print(f"🔑 {k}")
    
    log_keys(new_keys, note)
    
    print("\nKeep this script and SALT safe.")
