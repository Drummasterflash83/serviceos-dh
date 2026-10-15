"""Exact local Keychain binding for the approved database-reader credential.

The password is accepted through stdin and returned only to a capturing parent
process. It never appears in a shell command, process arguments or diagnostics.
"""
import ctypes
import json
import sys

PROJECT = "tgbnakbxwcqjeimygroz"
ROLE = "serviceos_backup_reader"
HOST = "aws-1-eu-west-2.pooler.supabase.com"
SERVICE = "OpenFolk.ServiceOS.DatabaseSource.Reader"
PROBE = "OpenFolk.ServiceOS.DatabaseSource.SyntheticProbe"

security = ctypes.CDLL("/System/Library/Frameworks/Security.framework/Security")
foundation = ctypes.CDLL("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation")
security.SecKeychainAddGenericPassword.argtypes = [ctypes.c_void_p, ctypes.c_uint32,
    ctypes.c_char_p, ctypes.c_uint32, ctypes.c_char_p, ctypes.c_uint32,
    ctypes.c_void_p, ctypes.POINTER(ctypes.c_void_p)]
security.SecKeychainAddGenericPassword.restype = ctypes.c_int32
security.SecKeychainFindGenericPassword.argtypes = [ctypes.c_void_p, ctypes.c_uint32,
    ctypes.c_char_p, ctypes.c_uint32, ctypes.c_char_p,
    ctypes.POINTER(ctypes.c_uint32), ctypes.POINTER(ctypes.c_void_p),
    ctypes.POINTER(ctypes.c_void_p)]
security.SecKeychainFindGenericPassword.restype = ctypes.c_int32
security.SecKeychainItemFreeContent.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
security.SecKeychainItemFreeContent.restype = ctypes.c_int32
security.SecKeychainItemDelete.argtypes = [ctypes.c_void_p]
security.SecKeychainItemDelete.restype = ctypes.c_int32
foundation.CFRelease.argtypes = [ctypes.c_void_p]


def add(service, account, password):
    service_bytes, account_bytes = service.encode(), account.encode()
    data = ctypes.create_string_buffer(password)
    item = ctypes.c_void_p()
    try:
        status = security.SecKeychainAddGenericPassword(None, len(service_bytes), service_bytes,
            len(account_bytes), account_bytes, len(password), data,
            ctypes.byref(item))
        if status != 0:
            raise RuntimeError("database_reader_keychain_add_failed")
    finally:
        ctypes.memset(data, 0, len(data))
        if item.value:
            foundation.CFRelease(item)


def find(service, account, *, with_item=False):
    service_bytes, account_bytes = service.encode(), account.encode()
    length = ctypes.c_uint32()
    pointer = ctypes.c_void_p()
    item = ctypes.c_void_p()
    status = security.SecKeychainFindGenericPassword(None, len(service_bytes), service_bytes,
        len(account_bytes), account_bytes, ctypes.byref(length), ctypes.byref(pointer),
        ctypes.byref(item))
    if status != 0:
        raise RuntimeError("database_reader_keychain_read_failed")
    try:
        password = ctypes.string_at(pointer, length.value)
    finally:
        security.SecKeychainItemFreeContent(None, pointer)
    if with_item:
        return password, item
    foundation.CFRelease(item)
    return password


def delete(service, account):
    _, item = find(service, account, with_item=True)
    try:
        if security.SecKeychainItemDelete(item) != 0:
            raise RuntimeError("database_reader_keychain_delete_failed")
    finally:
        foundation.CFRelease(item)


def main():
    if len(sys.argv) != 2 or sys.argv[1] not in ("--put", "--get", "--delete", "--probe"):
        raise RuntimeError("database_reader_keychain_mode_invalid")
    mode = sys.argv[1]
    if mode == "--probe":
        add(PROBE, PROJECT, b"synthetic-only")
        try:
            if find(PROBE, PROJECT) != b"synthetic-only":
                raise RuntimeError("database_reader_keychain_probe_failed")
        finally:
            delete(PROBE, PROJECT)
        print(json.dumps({"state": "synthetic_keychain_round_trip_verified"}))
    elif mode == "--put":
        value = json.load(sys.stdin)
        if not isinstance(value, dict) or set(value) != {"project", "role", "host", "password"} \
            or value["project"] != PROJECT or value["role"] != ROLE or value["host"] != HOST \
            or not isinstance(value["password"], str) or not 32 <= len(value["password"]) <= 256 \
            or any(c in value["password"] for c in "\r\n\0"):
            raise RuntimeError("database_reader_keychain_payload_invalid")
        add(SERVICE, PROJECT, json.dumps(value, separators=(",", ":")).encode())
        print(json.dumps({"state": "database_reader_keychain_stored"}))
    elif mode == "--delete":
        delete(SERVICE, PROJECT)
        print(json.dumps({"state": "database_reader_keychain_deleted"}))
    else:
        value = json.loads(find(SERVICE, PROJECT))
        if not isinstance(value, dict) or set(value) != {"project", "role", "host", "password"} \
            or value["project"] != PROJECT or value["role"] != ROLE or value["host"] != HOST:
            raise RuntimeError("database_reader_keychain_payload_invalid")
        sys.stdout.write(json.dumps(value, separators=(",", ":")))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(str(exc) if str(exc).startswith("database_reader_keychain_") else
              "database_reader_keychain_unavailable", file=sys.stderr)
        sys.exit(1)
