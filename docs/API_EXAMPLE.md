# CafeBazaar Review API example

This document uses synthetic values only. The application sends an HTTP `POST` with JSON to:

`https://api.cafebazaar.ir/rest-v1/process/ReviewRequest`

Request:

```json
{
  "singleRequest": {
    "reviewRequest": {
      "packageName": "com.example.app",
      "cursor": "",
      "sortBy": 1
    }
  }
}
```

Illustrative response skeleton:

```json
{
  "properties": {
    "statusCode": 200,
    "errorMessage": ""
  },
  "singleReply": {
    "reviewReply": {
      "reviews": [
        {
          "id": 123456,
          "user": "Sample User",
          "comment": "Sample review",
          "date": "2026/10/04",
          "rate": 5,
          "versionCode": 1,
          "likes": 2,
          "total": 2,
          "reply": null,
          "isEdited": false,
          "accountID": "fake-account-id",
          "avatarURL": "https://example.test/avatar.png",
          "userRepliesCount": 0
        }
      ],
      "nextPageCursor": "FAKE_NEXT_PAGE_CURSOR"
    }
  }
}
```

`sortBy: 1` selects Newest. The `nextPageCursor` is opaque: send it as the next request's `cursor` without parsing or changing it. The response's `id` is the per-app review key; `date` drives the import boundary. Other stored fields include user, comment, rating, version code, likes, total, reply, edit flag, account ID, avatar URL, and user reply count. The tool also records fetch time and a JSON copy of each review.
