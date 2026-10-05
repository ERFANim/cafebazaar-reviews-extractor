# User Guide

## Open the panel

Open the Google Sheet containing the script. From the menu, choose **CafeBazaar Reviews → Open Panel**. The panel lists configured apps and their import progress. If Google asks for authorization, approve the spreadsheet and external-request permissions to use the tool.

## Add an app

In **Add App**, enter:

1. **App Name:** A readable name for its review tab.
2. **Package Name:** The app's CafeBazaar package name, such as `com.example.app`.
3. **Import From Date:** The oldest review date you want, inclusive.

Click **Add & Import**. A dedicated tab is created for that app, and the initial import starts at the newest reviews and moves backward to your selected date. Each package can be added only once.

## Keep reviews current

When an app shows **READY**, click **Sync New Reviews**. Sync starts at the newest reviews, adds new ones, updates previously stored ones, and does not import dates before **Import From Date**.

To import older reviews, set an earlier date on the app card and click **Extend History**. Choosing the current date does nothing; choosing a newer date does not delete existing data.

## Pauses, errors, and repair

Long operations may show **PAUSED**. Click **Continue Import** or **Continue Sync** to resume from the saved point. There is no automatic background run. If an operation shows **ERROR**, read the message on the card, address the cause if possible, and click **Retry**.

A paused sync also offers **Cancel Sync & Repair**. Use it if an earlier version of the tool imported reviews before your configured date. After you confirm the prompt, it cancels that sync and removes only rows older than **Import From Date** from that app's review tab. Check the oldest remaining date afterward. The **Continue Sync** option remains available if you want to finish the paused operation instead.

The central `Apps` tab holds progress and status. Keep it intact; changing its headers or cursor cells can prevent resuming an operation.
