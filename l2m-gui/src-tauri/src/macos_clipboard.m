#import <Foundation/Foundation.h>
#import <AppKit/AppKit.h>

int copy_file_and_text_to_pasteboard(const char *path_utf8, const char *content_utf8) {
    if (!path_utf8) {
        return -1;
    }
    @autoreleasepool {
        NSString *path = [NSString stringWithUTF8String:path_utf8];
        if (!path || [path length] == 0) {
            return -1;
        }

        NSURL *fileURL = [NSURL fileURLWithPath:path];
        if (!fileURL) {
            return -1;
        }

        NSPasteboard *pb = [NSPasteboard generalPasteboard];
        [pb clearContents];

        NSMutableArray *objects = [NSMutableArray arrayWithObject:fileURL];
        if (content_utf8 && strlen(content_utf8) > 0) {
            NSString *content = [NSString stringWithUTF8String:content_utf8];
            if (content && [content length] > 0) {
                [objects addObject:content];
            }
        }

        BOOL ok = [pb writeObjects:objects];
        return ok ? 0 : -2;
    }
}
